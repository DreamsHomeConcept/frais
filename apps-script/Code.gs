/**
 * Notes de frais DHC — script Google Apps Script — version 1.2
 *  - envoi des notes validées par email (administrateurs)
 *  - réglages depuis l'onglet Paramètres de l'application (administrateurs)
 *  - lecture des tickets par Claude (membres de l'équipe, avec plafond quotidien)
 *
 * Installation : voir INSTALLATION.md. Déployer en « Application web » (Exécuter en tant que : Moi ; Accès : Tout le monde).
 *
 * Sécurité :
 *  - chaque appel est authentifié par le jeton de connexion Firebase de l'utilisateur, vérifié par Google ;
 *  - la clé API Claude et l'adresse de destination sont rangées dans les propriétés du script,
 *    jamais renvoyées à l'application (seuls les 4 derniers caractères de la clé sont affichés).
 */
const VERSION_SCRIPT = '1.2';
const CONFIG = {
  FIREBASE_API_KEY: 'AIzaSyBOr9WvhZKujhKsq7BfamcOI1JMIxEpQQw',      // identique à apiKey dans index.html
  FIREBASE_PROJECT_ID: 'notes-frais-dhc',   // identique à projectId dans index.html
  ADMIN_EMAIL: 'administration@dreamshomeconcept.com',
  DESTINATAIRE_DEFAUT: 'dreams-home-concept@box.libeo.io',
  NOM_EXPEDITEUR: 'Notes de frais DHC',
  MODELE: 'claude-haiku-4-5-20251001',
  PLAFOND_DEFAUT: 30,
  TAILLE_MAX_PDF: 20 * 1024 * 1024,   // limite Gmail : 25 Mo
  TAILLE_MAX_IMAGE: 5 * 1024 * 1024
};
const props = () => PropertiesService.getScriptProperties();
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    const u = identifier(p.idToken);
    if (!u.ok) return reponse(u);
    const action = p.action || 'envoi';
    if (action === 'lire-ticket') return reponse(lireTicket(p, u));
    if (!u.admin) return reponse({ ok: false, erreur: 'réservé aux administrateurs' });
    switch (action) {
      case 'envoi': return reponse(envoyer(p, u));
      case 'statut': return reponse(statut());
      case 'reglages': return reponse(reglages(p));
      case 'tester-cle': return reponse(testerCle());
      case 'email-test': return reponse(emailTest(u));
      default: return reponse({ ok: false, erreur: 'action inconnue' });
    }
  } catch (err) {
    return reponse({ ok: false, erreur: String(err && err.message || err).slice(0, 200) });
  }
}

/* ---------- Identité de l'appelant ---------- */
// Contrôle hors ligne : rejette tout jeton qui n'est pas un jeton de connexion de ce projet (évite la saturation du script)
function payloadJwt(t) {
  const p = String(t || '').split('.');
  if (p.length !== 3 || t.length > 4096) return null;
  try {
    const b = p[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Utilities.newBlob(Utilities.base64Decode(b + '='.repeat((4 - b.length % 4) % 4))).getDataAsString());
  } catch (e) { return null; }
}
function identifier(idToken) {
  if (!idToken) return { ok: false, erreur: 'non connecté' };
  const pl = payloadJwt(idToken);
  if (!pl || pl.aud !== CONFIG.FIREBASE_PROJECT_ID || pl.iss !== 'https://securetoken.google.com/' + CONFIG.FIREBASE_PROJECT_ID ||
      !(Number(pl.exp) * 1000 > Date.now())) return { ok: false, erreur: 'session expirée, reconnecte-toi' };
  const r = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + CONFIG.FIREBASE_API_KEY,
    { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return { ok: false, erreur: 'session expirée, reconnecte-toi' };
  const u = (JSON.parse(r.getContentText()).users || [])[0] || {};
  const email = String(u.email || '').toLowerCase();
  if (!email || !u.emailVerified) return { ok: false, erreur: 'compte non vérifié' };
  // La fiche users/{email} doit exister et être active pour tout le monde (même critère que les règles Firestore)
  const fiche = lireFiche(email, idToken);
  if (!fiche || champ(fiche, 'actif') !== true) return { ok: false, erreur: 'accès non autorisé' };
  const admin = email === CONFIG.ADMIN_EMAIL.toLowerCase() || champ(fiche, 'role') === 'admin';
  return { ok: true, email: email, admin: admin, token: idToken };
}
// Fiche Firestore users/{email} lue avec le jeton de l'utilisateur (les règles de sécurité s'appliquent)
function lireFiche(email, idToken) { return lireDoc('users/' + encodeURIComponent(email), idToken); }
function lireDoc(chemin, idToken) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + CONFIG.FIREBASE_PROJECT_ID + '/databases/(default)/documents/' + chemin;
  const r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + idToken }, muteHttpExceptions: true });
  return r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : null;
}
function champ(doc, nom) {
  const v = (doc && doc.fields || {})[nom];
  if (!v) return undefined;
  return v.stringValue !== undefined ? v.stringValue : v.booleanValue;
}

/* ---------- Réglages ---------- */
function destinataire() { return props().getProperty('DESTINATAIRE') || CONFIG.DESTINATAIRE_DEFAUT; }
function plafond() { return Number(props().getProperty('PLAFOND')) || CONFIG.PLAFOND_DEFAUT; }
function moisCourant() { return Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM'); }
function jourCourant() { return Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd'); }
function statut() {
  const cle = props().getProperty('CLAUDE_API_KEY');
  return { ok: true, version: VERSION_SCRIPT, destinataire: destinataire(), plafond: plafond(), modele: CONFIG.MODELE,
    cleApi: cle ? '…' + cle.slice(-4) : null, lecturesMois: Number(props().getProperty('LECTURES_' + moisCourant())) || 0 };
}
function reglages(p) {
  if (p.destinataire !== undefined) {
    const d = String(p.destinataire).trim().toLowerCase();
    if (!EMAIL_RE.test(d) || d.length > 120) return { ok: false, erreur: 'adresse de destination invalide' };
    props().setProperty('DESTINATAIRE', d);
  }
  if (p.plafond !== undefined) {
    const n = Math.round(Number(p.plafond));
    if (!(n >= 1 && n <= 500)) return { ok: false, erreur: 'plafond entre 1 et 500' };
    props().setProperty('PLAFOND', String(n));
  }
  if (p.supprimerCle) props().deleteProperty('CLAUDE_API_KEY');
  if (p.cleApi) {
    const cle = String(p.cleApi).trim();
    if (!/^sk-ant-[A-Za-z0-9_\-]{20,250}$/.test(cle)) return { ok: false, erreur: 'la clé doit commencer par sk-ant-' };
    const t = appelClaude(cle, { max_tokens: 5, messages: [{ role: 'user', content: 'Réponds OK' }] });
    if (!t.ok) return { ok: false, erreur: 'clé refusée par Claude : ' + t.erreur };
    props().setProperty('CLAUDE_API_KEY', cle);
  }
  return statut();
}
function testerCle() {
  const cle = props().getProperty('CLAUDE_API_KEY');
  if (!cle) return { ok: false, erreur: 'aucune clé enregistrée' };
  const t = appelClaude(cle, { max_tokens: 5, messages: [{ role: 'user', content: 'Réponds OK' }] });
  return t.ok ? { ok: true } : { ok: false, erreur: t.erreur };
}
function emailTest(u) {
  GmailApp.sendEmail(u.email, 'Test — Notes de frais DHC',
    'Le script d\'envoi fonctionne.\n\nLes notes validées sont envoyées à : ' + destinataire() + '\nVersion du script : ' + VERSION_SCRIPT,
    { name: CONFIG.NOM_EXPEDITEUR });
  return { ok: true, a: u.email };
}

/* ---------- Envoi d'une note ---------- */
function envoyer(p, u) {
  let cc = '';
  const ccDemande = String(p.cc || '').toLowerCase();
  if (ccDemande && EMAIL_RE.test(ccDemande) && lireFiche(ccDemande, u.token)) cc = ccDemande; // copie : membres de l'équipe uniquement
  if (!p.pdf || !/^[A-Za-z0-9+/=]+$/.test(p.pdf)) return { ok: false, erreur: 'PDF manquant' };
  const octets = Utilities.base64Decode(p.pdf);
  if (octets.length > CONFIG.TAILLE_MAX_PDF) return { ok: false, erreur: 'PDF trop volumineux' };
  const nomFichier = texte(p.nomFichier, 120).replace(/[^A-Za-z0-9_.\-]/g, '_') || 'note_de_frais.pdf';
  const pdf = Utilities.newBlob(octets, 'application/pdf', nomFichier);
  const numero = texte(p.numero, 60), nom = texte(p.nom, 80), periode = texte(p.periode, 40), montant = texte(p.montant, 30);
  const complement = Number(p.complement) > 0;
  const sujet = 'Note de frais ' + numero + ' — ' + nom + ' — ' + periode + ' — ' + montant;
  const corps = [
    'Bonjour,', '',
    (complement ? 'Veuillez trouver ci-joint le complément de note de frais ' : 'Veuillez trouver ci-joint la note de frais ') + numero + ', validée.', '',
    'Déclarant : ' + nom, 'Période : ' + periode, 'Nombre de lignes : ' + Number(p.nbLignes || 0), 'Montant total : ' + montant, '',
    'Le PDF contient le détail des dépenses, les indemnités kilométriques et les justificatifs.', '',
    'Dreams Home Concept — envoi automatique de l\'application Notes de frais'
  ].join('\n');
  const options = { attachments: [pdf], name: CONFIG.NOM_EXPEDITEUR };
  if (cc) options.cc = cc;
  const dest = destinataire();
  GmailApp.sendEmail(dest, sujet, corps, options);
  return { ok: true, destinataire: dest, cc: cc };
}

/* ---------- Lecture d'un ticket par Claude ---------- */
function lireTicket(p, u) {
  const cle = props().getProperty('CLAUDE_API_KEY');
  if (!cle) return { ok: false, erreur: 'lecture des tickets non configurée' };
  // Interrupteur de l'onglet Paramètres (config/app → ocr.actif)
  const cfg = lireDoc('config/app', u.token);
  const ocr = cfg && cfg.fields && cfg.fields.ocr && cfg.fields.ocr.mapValue && cfg.fields.ocr.mapValue.fields || {};
  if (!ocr.actif || ocr.actif.booleanValue !== true) return { ok: false, erreur: 'lecture des tickets désactivée par l\'administrateur' };
  const media = p.mime === 'image/png' ? 'image/png' : 'image/jpeg';
  if (!p.image || !/^[A-Za-z0-9+/=]+$/.test(p.image) || p.image.length > CONFIG.TAILLE_MAX_IMAGE) return { ok: false, erreur: 'photo invalide ou trop lourde' };

  // Plafond quotidien par personne
  const kq = 'QUOTA_' + jourCourant() + '_' + u.email, km = 'LECTURES_' + moisCourant();
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const n = Number(props().getProperty(kq)) || 0;
    if (n >= plafond()) return { ok: false, erreur: 'plafond de ' + plafond() + ' lectures atteint aujourd\'hui' };
    props().setProperty(kq, String(n + 1));
    props().setProperty(km, String((Number(props().getProperty(km)) || 0) + 1));
  } finally { lock.releaseLock(); }
  if (Math.random() < 0.05) nettoyerQuotas();

  const cats = (Array.isArray(p.categories) ? p.categories : []).slice(0, 40)
    .map(c => ({ id: texte(c && c.id, 30).replace(/[^a-z0-9_\-]/gi, ''), lib: texte(c && c.lib, 60) })).filter(c => c.id);
  const ids = cats.length ? cats.map(c => c.id) : ['autre'];
  const outil = {
    name: 'enregistrer_ticket',
    description: 'Enregistre les informations lues sur un ticket de caisse ou une facture.',
    input_schema: {
      type: 'object',
      properties: {
        lisible: { type: 'boolean', description: 'false si la photo ne montre pas un ticket ou une facture lisible' },
        date: { type: ['string', 'null'], description: 'Date de la dépense, format AAAA-MM-JJ' },
        enseigne: { type: ['string', 'null'], description: 'Nom du commerce ou du fournisseur' },
        description: { type: ['string', 'null'], description: 'Nature de la dépense en quelques mots, en français (ex. « Repas 2 couverts », « Plein gazole »)' },
        montant_ttc: { type: ['number', 'null'], description: 'Montant total payé, taxes comprises, dans la devise du ticket' },
        devise: { type: ['string', 'null'], description: 'Code ISO 4217 de la devise du ticket (EUR, CHF, TRY…)' },
        tva_montant: { type: ['number', 'null'], description: 'Montant total de TVA indiqué sur le ticket (somme de tous les taux), null si absent' },
        tva_taux: { type: ['number', 'null'], description: 'Taux de TVA en % s\'il n\'y en a qu\'un, sinon null' },
        plusieurs_taux: { type: 'boolean', description: 'true si le ticket applique plusieurs taux de TVA' },
        categorie: { type: 'string', enum: ids, description: 'Catégorie la plus adaptée parmi la liste' },
        paiement: { type: 'string', enum: ['carte', 'especes', 'inconnu'] },
        confiance: { type: 'string', enum: ['haute', 'moyenne', 'basse'], description: 'Fiabilité globale de la lecture' },
        remarque: { type: ['string', 'null'], description: 'Problème éventuel en français (ticket coupé, montant illisible, plusieurs tickets…)' }
      },
      required: ['lisible', 'date', 'enseigne', 'description', 'montant_ttc', 'devise', 'tva_montant', 'tva_taux', 'plusieurs_taux', 'categorie', 'paiement', 'confiance', 'remarque']
    }
  };
  const consigne = 'Voici la photo d\'un justificatif de dépense professionnelle (ticket de caisse, facture ou reçu) ' +
    'd\'une entreprise française du bâtiment. Lis-le et appelle l\'outil enregistrer_ticket.\n' +
    '- Montant : le total réellement payé (TTC), pas un sous-total ni le rendu monnaie.\n' +
    '- Montants en nombres décimaux avec un point (ex. 24.50).\n' +
    '- N\'invente rien : mets null pour une information absente ou illisible, et baisse la confiance.\n' +
    (cats.length ? '- Catégories possibles : ' + cats.map(c => c.id + ' = ' + c.lib).join(' ; ') + '.' : '');
  const r = appelClaude(cle, {
    max_tokens: 800, tools: [outil], tool_choice: { type: 'tool', name: 'enregistrer_ticket' },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: media, data: p.image } },
      { type: 'text', text: consigne }
    ] }]
  });
  if (!r.ok) { rembourserQuota(kq, km); return { ok: false, erreur: r.erreur }; }
  const bloc = (r.data.content || []).find(b => b.type === 'tool_use');
  if (!bloc || !bloc.input) { rembourserQuota(kq, km); return { ok: false, erreur: 'réponse inattendue de Claude' }; }
  return { ok: true, ticket: bloc.input };
}
function rembourserQuota(kq, km) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    [kq, km].forEach(k => { const n = Number(props().getProperty(k)) || 0; if (n > 0) props().setProperty(k, String(n - 1)); });
  } finally { lock.releaseLock(); }
}
function nettoyerQuotas() {
  const aujourd = 'QUOTA_' + jourCourant() + '_';
  props().getKeys().filter(k => k.indexOf('QUOTA_') === 0 && k.indexOf(aujourd) !== 0).forEach(k => props().deleteProperty(k));
}
function appelClaude(cle, corps) {
  corps.model = CONFIG.MODELE;
  const r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(corps),
    headers: { 'x-api-key': cle, 'anthropic-version': '2023-06-01' }
  });
  const code = r.getResponseCode();
  let data = {}; try { data = JSON.parse(r.getContentText()); } catch (e) { }
  if (code === 200) return { ok: true, data: data };
  const msg = { 401: 'clé API invalide', 403: 'clé API sans autorisation', 429: 'trop de demandes, réessaie dans une minute',
    529: 'service Claude surchargé, réessaie', 400: 'demande refusée (' + ((data.error || {}).message || 'photo illisible ?') + ')' }[code];
  const credit = /credit|billing/i.test(JSON.stringify(data.error || '')) ? 'crédit API épuisé (console.anthropic.com)' : null;
  return { ok: false, erreur: credit || msg || ('erreur Claude ' + code) };
}

/* ---------- Utilitaires ---------- */
function texte(v, max) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, max); }
function reponse(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// Test manuel depuis l'éditeur : accorde les autorisations (Gmail, appels externes) et envoie un email à vous-même
function testerAutorisation() {
  UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', { muteHttpExceptions: true });
  GmailApp.sendEmail(Session.getActiveUser().getEmail(), 'Test Notes de frais DHC', 'Le script est autorisé à envoyer des emails.');
}
