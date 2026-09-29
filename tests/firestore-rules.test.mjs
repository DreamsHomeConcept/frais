import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import fs from 'fs';
const env = await initializeTestEnvironment({ projectId: 'notes-frais-dhc', firestore: { rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 } });
const SA = 'administration@dreamshomeconcept.com';
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  const u = (e, d) => db.collection('users').doc(e).set({ email: e, nom: e, vehicules: [], ...d });
  await u('alice@x.fr', { role: 'declarant', actif: true });
  await u('bob@x.fr', { role: 'declarant', actif: true });
  await u('carl@x.fr', { role: 'admin', actif: false });
  await u('dan@x.fr', { role: 'admin', actif: true });
  const d = (id, o) => db.collection('depenses').doc(id).set({ type: 'frais', date: '2026-09-01', mois: '2026-09', montant: 10, ...o });
  await d('a1', { owner: 'alice@x.fr', statut: 'soumise' });
  await d('a2', { owner: 'alice@x.fr', statut: 'validee', valideLe: 'x', validePar: 'dan@x.fr' });
  await d('a3', { owner: 'alice@x.fr', statut: 'refusee' });
  await d('b1', { owner: 'bob@x.fr', statut: 'soumise' });
  await db.collection('justifs').doc('b1').set({ owner: 'bob@x.fr', data: 'data:image/jpeg;base64,AAAA', mime: 'image/jpeg', nom: 'x.jpg' });
  await db.collection('config').doc('app').set({ scriptUrl: '' });
  await db.collection('remboursements').doc('r1').set({ owner: 'alice@x.fr' });
  await db.collection('envois').doc('e1').set({ owner: 'bob@x.fr' });
});
const ctx = (email, verified = true) => env.authenticatedContext(email, { email, email_verified: verified }).firestore();
const A = ctx('alice@x.fr'), ADM = ctx('dan@x.fr'), SUP = ctx(SA);
const J = (o, id='new1') => ({ owner: 'alice@x.fr', data: 'data:image/jpeg;base64,/9j/AAAA', mime: 'image/jpeg', nom: 'a.jpg', createdAt: 'x', ...o });
const F = o => ({ type: 'frais', date: '2026-09-12', mois: '2026-09', categorie: 'repas', description: 'Déjeuner chantier', chantier: 'Estrablin', paiement: 'avance',
  ttc: 24.5, tva: 2.23, ht: 22.27, tauxTva: 10, tvaManuelle: false, devise: 'EUR', montantDevise: null, tauxChange: null, montant: 24.5, sansJustificatif: false,
  owner: 'alice@x.fr', ownerNom: 'Alice', statut: 'soumise', motifRefus: null, valideLe: null, validePar: null, updatedAt: 'x', createdAt: 'x', justif: { mime: 'image/jpeg', nom: 'a.jpg' }, ...o });
const IK = o => ({ type: 'ik', date: '2026-09-12', mois: '2026-09', categorie: 'ik', description: 'Réunion', chantier: '', paiement: 'ik', depart: 'Annecy', arrivee: 'Estrablin', km: 150, allerRetour: true, kmTotal: 300,
  vehiculeId: 'v1', vehiculeLib: 'Peugeot', cv: 7, electrique: true, cumulAvant: 0, bareme: 'Barème 2026', ttc: 250.92, tva: 0, ht: 250.92, tauxTva: 0, montant: 250.92, sansJustificatif: true,
  owner: 'alice@x.fr', ownerNom: 'Alice', statut: 'soumise', motifRefus: null, valideLe: null, validePar: null, updatedAt: 'x', createdAt: 'x', ...o });
const T = [
 ['Appli : dépense réelle (frais)', 'allow', () => A.collection('depenses').doc('f1').set(F({}))],
 ['Appli : dépense en CHF', 'allow', () => A.collection('depenses').doc('f2').set(F({ devise: 'CHF', montantDevise: 30, tauxChange: 0.9, ttc: 27, tva: 0, ht: 27, tauxTva: 0, montant: 27 }))],
 ['Appli : trajet 7 CV électrique 300 km', 'allow', () => A.collection('depenses').doc('i1').set(IK({}))],
 ['Appli : correction d\'une dépense refusée (doc complet)', 'allow', () => A.collection('depenses').doc('a3').set(F({ motifRefus: null }))],
 ['Appli : dépense + justificatif (lot)', 'allow', () => { const b = A.batch(); b.set(A.collection('depenses').doc('n4'), F({})); b.set(A.collection('justifs').doc('n4'), J({})); return b.commit(); }],
 ['Déclarant se nomme admin', 'deny', () => A.collection('users').doc('alice@x.fr').update({ role: 'admin' })],
 ['Déclarant modifie ses véhicules', 'allow', () => A.collection('users').doc('alice@x.fr').update({ vehicules: [{ id: 'v', cv: 5 }] })],
 ['Déclarant lit la fiche d\'un collègue', 'deny', () => A.collection('users').doc('bob@x.fr').get()],
 ['Déclarant se crée une fiche', 'deny', () => A.collection('users').doc('eve@x.fr').set({ role: 'admin', actif: true })],
 ['Déclarant crée une dépense « en attente »', 'allow', () => A.collection('depenses').doc('n1').set(F({}))],
 ['Déclarant crée une dépense déjà « validée »', 'deny', () => A.collection('depenses').doc('n2').set(F({ statut: 'validee' }))],
 ['Déclarant crée une dépense au nom d\'un collègue', 'deny', () => A.collection('depenses').doc('n3').set({ owner: 'bob@x.fr', statut: 'soumise' })],
 ['Déclarant valide sa propre dépense', 'deny', () => A.collection('depenses').doc('a1').update({ statut: 'validee' })],
 ['Déclarant écrit un remboursement', 'deny', () => A.collection('depenses').doc('a1').update({ remboursement: { date: 'x' } })],
 ['Déclarant modifie une dépense déjà validée', 'deny', () => A.collection('depenses').doc('a2').update({ montant: 999, statut: 'soumise', valideLe: null, validePar: null })],
 ['Déclarant supprime une dépense validée', 'deny', () => A.collection('depenses').doc('a2').delete()],
 ['Déclarant corrige une dépense refusée', 'allow', () => A.collection('depenses').doc('a3').update({ statut: 'soumise', montant: 11, ttc: 11, type: 'frais', date: '2026-09-01', mois: '2026-09' })],
 ['Déclarant donne sa dépense à un collègue', 'deny', () => A.collection('depenses').doc('a1').update({ owner: 'bob@x.fr' })],
 ['Déclarant lit la dépense d\'un collègue', 'deny', () => A.collection('depenses').doc('b1').get()],
 ['Déclarant liste ses dépenses', 'allow', () => A.collection('depenses').where('owner', '==', 'alice@x.fr').get()],
 ['Déclarant liste toutes les dépenses', 'deny', () => A.collection('depenses').get()],
 ['Déclarant lit le justificatif d\'un collègue', 'deny', () => A.collection('justifs').doc('b1').get()],
 ['Justificatif contenant du HTML', 'deny', () => { const b = A.batch(); b.set(A.collection('depenses').doc('n5'), F({})); b.set(A.collection('justifs').doc('n5'), J({ data: 'data:text/html;base64,PHNjcmlwdD4=' , mime:'text/html'})); return b.commit(); }],
 ['Justificatif attaché à la dépense d\'un collègue', 'deny', () => A.collection('justifs').doc('b1').set(J({}))],
 ['Déclarant modifie les paramètres', 'deny', () => A.collection('config').doc('app').set({ versionMin: '9.9' }, { merge: true })],
 ['Déclarant lit les paramètres', 'allow', () => A.collection('config').doc('app').get()],
 ['Déclarant lit les remboursements', 'deny', () => A.collection('remboursements').get()],
 ['Déclarant lit l\'envoi d\'un collègue', 'deny', () => A.collection('envois').doc('e1').get()],
 ['Déclarant crée un envoi', 'deny', () => A.collection('envois').doc('e2').set({ owner: 'alice@x.fr' })],
 ['Email non vérifié', 'deny', () => ctx('alice@x.fr', false).collection('config').doc('app').get()],
 ['Inconnu (email vérifié, hors équipe)', 'deny', () => ctx('eve@x.fr').collection('config').doc('app').get()],
 ['Admin désactivé', 'deny', () => ctx('carl@x.fr').collection('depenses').get()],
 ['Non connecté', 'deny', () => env.unauthenticatedContext().firestore().collection('config').doc('app').get()],
 ['Super-admin crée sa fiche au 1er accès', 'allow', () => SUP.collection('users').doc(SA).set({ role: 'admin', actif: true })],
 ['Admin : adresse de script piégée', 'deny', () => ADM.collection('config').doc('app').set({ scriptUrl: 'https://evil.com/x' }, { merge: true })],
 ['Admin : adresse de script Google', 'allow', () => ADM.collection('config').doc('app').set({ scriptUrl: 'https://script.google.com/macros/s/abc_D-1/exec' }, { merge: true })],
 ['Admin valide une dépense', 'allow', () => ADM.collection('depenses').doc('b1').update({ statut: 'validee' })],
 // Failles attendues (non couvertes par les règles)
 ['[faille] Trajet IK de 10 km à 9 999 €', 'deny', () => A.collection('depenses').doc('n6').set(IK({ kmTotal: 10, montant: 9999, ttc: 9999 }))],
 ['[faille] Montant négatif', 'deny', () => A.collection('depenses').doc('n7').set(F({ montant: -500, ttc: -500 }))],
 ['[faille] Montant en texte', 'deny', () => A.collection('depenses').doc('n8').set(F({ montant: 'abc', ttc: 'abc' }))],
 ['[faille] Mois différent de la date', 'deny', () => A.collection('depenses').doc('n9').set(F({ mois: '2024-01' }))],
 ['[faille] Description de 500 000 caractères', 'deny', () => A.collection('depenses').doc('n10').set(F({ description: 'x'.repeat(500000) }))],
 ['[faille] Champ inconnu volumineux', 'deny', () => A.collection('depenses').doc('n11').set(F({ bourrage: 'x'.repeat(500000) }))],
 ['[choix] Admin valide sa propre dépense', 'allow', async () => { await ADM.collection('depenses').doc('d1').set({ owner: 'dan@x.fr', statut: 'soumise' }); return ADM.collection('depenses').doc('d1').update({ statut: 'validee' }); }],
];
let ko = 0;
for (const [n, exp, f] of T) {
  let got; try { await f(); got = 'allow'; } catch (e) { got = e.code === 'permission-denied' || /PERMISSION_DENIED/.test(e.message) ? 'deny' : 'ERR ' + e.message.slice(0, 80); }
  const ok = got === exp; if (!ok) ko++;
  console.log((ok ? 'OK   ' : 'ÉCART') + ' | attendu ' + exp + ' | obtenu ' + got + ' | ' + n);
}
console.log('écarts:', ko);
await env.cleanup(); process.exit(ko ? 1 : 0);
