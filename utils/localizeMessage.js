/**
 * Traduction des messages d'erreur de l'API. Les services lèvent leurs erreurs en français (langue
 * d'origine) ; quand le client demande l'anglais (en-tête X-Language, sinon langue du compte), le
 * message est remplacé ici par sa version anglaise avant l'envoi de la réponse.
 */
const EXACT = {
  "Seule la partie visée par le signalement peut redéposer le document.": "Only the party concerned by the report can upload the document again.",
  "Un document corrigé vient d'être déposé. Vérifiez-le avant d'en déposer un autre.": "A corrected document has just been uploaded. Review it before uploading another one.",
  "Offre acceptée. La procédure d'achat a commencé.": "Offer accepted. The purchase procedure has started.",
  "Adresse e-mail vérifiée avec succès. Utilisateur connecté.": "E-mail address verified successfully. User logged in.",
  "Code de réinitialisation envoyé par e-mail.": "Reset code sent by e-mail.",
  "Commission réglée. Votre compte est réactivé.": "Commission paid. Your account is reactivated.",
  "Commission réglée. Vous pouvez passer au virement au vendeur.": "Commission paid. You can proceed to the transfer to the seller.",
  "Connexion réussie.": "Login successful.",
  "Document déposé. Les deux parties doivent de nouveau vérifier les documents.": "Document uploaded. Both parties must review the documents again.",
  "Données de la carte grise enregistrées.": "Registration certificate data saved.",
  "Déconnexion réussie.": "Logout successful.",
  "Inscription Étape 1 réussie. Code de validation OTP envoyé par e-mail.": "Registration step 1 successful. Verification code sent by e-mail.",
  "Inscription Étape 2 réussie. Votre dossier a été soumis pour validation administrative.": "Registration step 2 successful. Your file has been submitted for administrative validation.",
  "Langue mise à jour avec succès.": "Language updated successfully.",
  "Le véhicule est de nouveau disponible pour une session.": "The vehicle is available again for a session.",
  "Message ajouté au ticket.": "Message added to the ticket.",
  "Mot de passe réinitialisé avec succès.": "Password reset successfully.",
  "Notifications marquées comme lues.": "Notifications marked as read.",
  "Nouveau code OTP envoyé.": "New verification code sent.",
  "Profil mis à jour.": "Profile updated.",
  "Réception du virement confirmée.": "Transfer receipt confirmed.",
  "Tampon mis à jour avec succès.": "Stamp updated successfully.",
  "Ticket de support créé avec succès.": "Support ticket created successfully.",
  "Ticket supprimé avec succès.": "Ticket deleted successfully.",
  "Vente annulée et compte suspendu.": "Sale cancelled and account suspended.",
  "Votre offre a bien été annulée.": "Your offer has been cancelled.",
  "Votre offre a bien été enregistrée.": "Your offer has been saved.",
  "Votre offre a bien été modifiée.": "Your offer has been updated.",
  "Dossier supprimé.": "File deleted.",
  "Dossier véhicule mis à jour.": "Vehicle file updated.",
  "Dossier véhicule supprimé.": "Vehicle file deleted.",
  "Accès refusé. Vous n'êtes pas le propriétaire de ce dossier.": "Access denied. You do not own this file.",
  "Acheteur introuvable.": "Buyer not found.",
  "Ce fichier ne provient pas d'une source autorisée.": "This file does not come from an authorized source.",
  "Ce format d'image n'est pas pris en charge pour le floutage.": "This image format is not supported for blurring.",
  "Ce véhicule n'attend pas de décision vendeur.": "This vehicle is not awaiting a seller decision.",
  "Cette image n'a pas pu être lue. Envoyez une photo au format JPEG ou PNG.": "This image could not be read. Please send a JPEG or PNG photo.",
  "Cette offre a déjà été consommée et n'est plus disponible.": "This offer has already been used and is no longer available.",
  "Cette offre n'est plus disponible.": "This offer is no longer available.",
  "Cette vente n'est pas active.": "This sale is not active.",
  "Cette vente n'est plus active : elle ne peut pas être arrêtée.": "This sale is no longer active: it cannot be stopped.",
  "Cette vente n'est plus en cours.": "This sale is no longer in progress.",
  "Impossible de déterminer les dimensions de l'image.": "Unable to determine the image dimensions.",
  "Impossible de récupérer l'image originale.": "Unable to retrieve the original image.",
  "Impossible de récupérer le document PDF original.": "Unable to retrieve the original PDF document.",
  "L'URL de l'image est requise.": "The image URL is required.",
  "L'URL du document est requise.": "The document URL is required.",
  "L'URL du fichier fournie est invalide.": "The provided file URL is invalid.",
  "L'annulation n'est possible qu'à l'étape 1.": "Cancellation is only possible at step 1.",
  "L'immatriculation d'un dossier véhicule existant ne peut pas être modifiée.": "The registration number of an existing vehicle file cannot be changed.",
  "Le délai de décision vendeur est dépassé. Le véhicule est déjà revenu en attente de session.": "The seller decision deadline has passed. The vehicle has already returned to waiting for a session.",
  "Le délai de décision vendeur est dépassé. Le véhicule est revenu en attente de session.": "The seller decision deadline has passed. The vehicle has returned to waiting for a session.",
  "Le numéro d'immatriculation est requis.": "The registration number is required.",
  "Le paiement de la commission n'a pas encore été confirmé par Stripe.": "The commission payment has not yet been confirmed by Stripe.",
  "Le service de recherche d'immatriculation n'est pas configuré.": "The registration lookup service is not configured.",
  "Le service de stockage de fichiers n'est pas configuré.": "The file storage service is not configured.",
  "Seules les étapes 1 (commission) et 2 (virement) ont un délai prolongeable.": "Only steps 1 (commission) and 2 (transfer) have an extendable deadline.",
  "Votre compte vendeur doit être validé pour accéder à cette fonctionnalité.": "Your seller account must be approved to access this feature.",
  "Votre dossier doit d'abord être validé pour modifier votre profil ici.": "Your file must first be approved before you can edit your profile here.",
  "Accès refusé. Vous n'êtes pas l'auteur de ce ticket.": "Access denied. You are not the author of this ticket.",
  "Accès refusé.": "Access denied.",
  "Action non autorisée. Seul un administrateur peut modifier le statut d'un ticket vers un autre état que clôturé.": "Action not allowed. Only an administrator can change a ticket's status to anything other than closed.",
  "Aucun fichier fourni dans la requête.": "No file provided in the request.",
  "Aucun paiement en attente pour cette vente.": "No pending payment for this sale.",
  "Aucun utilisateur trouvé avec cet e-mail.": "No user found with this e-mail.",
  "Ce compte ne correspond pas à cet espace de connexion.": "This account does not match this login area.",
  "Ce dossier ne peut pas être supprimé dans son statut actuel.": "This file cannot be deleted in its current status.",
  "Ce dossier ne peut plus être modifié dans son statut actuel.": "This file can no longer be edited in its current status.",
  "Ce numéro SIRET est déjà enregistré par un autre compte.": "This SIRET number is already registered by another account.",
  "Ce numéro de téléphone est déjà utilisé par un autre compte.": "This phone number is already used by another account.",
  "Ce paiement ne correspond pas à cette vente.": "This payment does not match this sale.",
  "Ce véhicule est en cours de vente. Le vendeur ne peut plus modifier ou supprimer le dossier pendant la procédure de vente.": "This vehicle is being sold. The seller can no longer edit or delete the file during the sales procedure.",
  "Cet e-mail est déjà utilisé par un autre compte.": "This e-mail is already used by another account.",
  "Cet e-mail est déjà vérifié.": "This e-mail is already verified.",
  "Cette raison sociale (nom d’entreprise) est déjà enregistrée par un autre compte.": "This company name is already registered by another account.",
  "Cette session a déjà été clôturée et ses gagnants désignés.": "This session has already been closed and its winners designated.",
  "Choisissez comment récupérer les papiers du véhicule : en main propre ou par voie postale.": "Choose how to collect the vehicle documents: in person or by post.",
  "Clé et type requis.": "Key and type are required.",
  "Code de vérification invalide.": "Invalid verification code.",
  "Compte vendeur suspendu : ce véhicule ne peut pas être ajouté à une session.": "Seller account suspended: this vehicle cannot be added to a session.",
  "Dossier véhicule introuvable.": "Vehicle file not found.",
  "Erreur lors de l'ajout du véhicule à la session.": "Error while adding the vehicle to the session.",
  "Erreur lors de la clôture de la session.": "Error while closing the session.",
  "Erreur lors de la création de la session.": "Error while creating the session.",
  "Erreur lors de la mise à jour de la configuration.": "Error while updating the configuration.",
  "Erreur lors de la récupération de la configuration.": "Error while retrieving the configuration.",
  "Erreur lors de la récupération de la session.": "Error while retrieving the session.",
  "Erreur lors de la récupération des sessions.": "Error while retrieving the sessions.",
  "Erreur lors de la récupération des ventes en cours.": "Error while retrieving the ongoing sales.",
  "Erreur lors de la récupération du véhicule.": "Error while retrieving the vehicle.",
  "Erreur lors du retrait du véhicule de la session.": "Error while removing the vehicle from the session.",
  "L'ID du véhicule est requis.": "The vehicle ID is required.",
  "L'adresse complète est obligatoire.": "The full address is required.",
  "L'e-mail est obligatoire.": "The e-mail is required.",
  "La commission de cette vente a déjà été réglée.": "The commission for this sale has already been paid.",
  "La date de début est requise.": "The start date is required.",
  "La raison de suspension est obligatoire pour un compte acheteur.": "A suspension reason is required for a buyer account.",
  "La sélection de la vitrine est invalide.": "The showcase selection is invalid.",
  "Le code de vérification a expiré.": "The verification code has expired.",
  "Le contenu de la note est obligatoire.": "The note content is required.",
  "Le contenu de la note interne est requis.": "The internal note content is required.",
  "Le contenu du message est obligatoire.": "The message content is required.",
  "Le contenu du message est requis.": "The message content is required.",
  "Le document K-bis et la carte d'identité (recto/verso) sont obligatoires.": "The K-bis document and the ID card (front/back) are required.",
  "Le délai de paiement de la commission est dépassé.": "The commission payment deadline has passed.",
  "Le fichier est trop lourd. La taille maximale autorisée est de 30 Mo.": "The file is too large. The maximum allowed size is 30 MB.",
  "Le format du numéro de téléphone est invalide.": "The phone number format is invalid.",
  "Le montant de la commission impayée est introuvable.": "The unpaid commission amount could not be found.",
  "Le montant payé ne correspond pas à la commission due. Veuillez relancer le paiement.": "The amount paid does not match the commission due. Please restart the payment.",
  "Le nom de la session est requis.": "The session name is required.",
  "Le nouveau statut est requis.": "The new status is required.",
  "Le numéro SIRET doit contenir exactement 14 chiffres.": "The SIRET number must contain exactly 14 digits.",
  "Le numéro SIRET est obligatoire.": "The SIRET number is required.",
  "Le service de stockage de fichiers est momentanément indisponible. Veuillez réessayer plus tard ou contacter le support.": "The file storage service is temporarily unavailable. Please try again later or contact support.",
  "Le tampon doit être une image (photo ou scan).": "The stamp must be an image (photo or scan).",
  "Le titre et le contenu du message initial sont obligatoires.": "The title and the content of the initial message are required.",
  "Le titre et le message initial sont requis.": "The title and the initial message are required.",
  "Les coordonnées bancaires complètes sont obligatoires pour un vendeur.": "Complete bank details are required for a seller.",
  "Message introuvable.": "Message not found.",
  "Non autorisé, aucun jeton fourni.": "Not authorized, no token provided.",
  "Non autorisé, jeton invalide ou expiré.": "Not authorized, invalid or expired token.",
  "Non autorisé, utilisateur introuvable.": "Not authorized, user not found.",
  "Non autorisé.": "Not authorized.",
  "Notification introuvable.": "Notification not found.",
  "Paiement indisponible (Stripe non configuré).": "Payment unavailable (Stripe not configured).",
  "Session introuvable.": "Session not found.",
  "Ticket introuvable.": "Ticket not found.",
  "Tous les champs obligatoires doivent être renseignés.": "All required fields must be filled in.",
  "Tranche de commission introuvable.": "Commission tier not found.",
  "Un message avec cette clé existe déjà.": "A message with this key already exists.",
  "Un ou plusieurs véhicules ne sont plus disponibles pour la vitrine.": "One or more vehicles are no longer available for the showcase.",
  "Une procédure de vente est déjà engagée pour ce véhicule.": "A sales procedure has already been started for this vehicle.",
  "Utilisateur introuvable": "User not found",
  "Utilisateur introuvable.": "User not found.",
  "Vente introuvable ou accès refusé.": "Sale not found or access denied.",
  "Vente introuvable.": "Sale not found.",
  "Veuillez spécifier au moins un motif de correction.": "Please specify at least one correction reason.",
  "Veuillez spécifier au moins un motif de refus.": "Please specify at least one refusal reason.",
  "Vos modifications de profil sont en attente de validation : vous pouvez terminer vos ventes en cours, mais aucune nouvelle action n'est possible pour le moment.": "Your profile changes are awaiting validation: you can finish your ongoing sales, but no new action is possible for now.",
  "Votre compte est bloqué. Veuillez contacter le support.": "Your account is blocked. Please contact support.",
  "Votre compte est bloqué.": "Your account is blocked.",
  "Votre compte est suspendu. Réglez votre commission impayée pour débloquer votre compte.": "Your account is suspended. Pay your unpaid commission to unblock your account.",
  "Votre compte est suspendu. Seuls le règlement de votre commission, vos ventes en cours et le support sont autorisés.": "Your account is suspended. Only the payment of your commission, your ongoing sales and support are allowed.",
  "Votre inscription a été définitivement refusée. Veuillez contacter le support.": "Your registration has been permanently refused. Please contact support.",
  "Véhicule introuvable.": "Vehicle not found.",
  "Dossier véhicule introuvable": "Vehicle file not found.",
  "Cette session a déjà été clôturée.": "This session has already been closed.",
  "Une erreur interne est survenue sur le serveur.": "An internal server error occurred.",
  "Une erreur est survenue.": "An error occurred.",
  "L'adresse e-mail et le code OTP sont obligatoires.": "The e-mail address and the OTP code are required.",
  "L'adresse e-mail et le mot de passe sont obligatoires.": "The e-mail address and the password are required.",
  "L'e-mail, le code et le nouveau mot de passe sont obligatoires.": "The e-mail, the code and the new password are required.",
  "E-mail ou mot de passe incorrect.": "Incorrect e-mail or password.",
  "Veuillez d'abord valider votre adresse e-mail.": "Please verify your e-mail address first.",
  "URL de tampon invalide.": "Invalid stamp URL.",
  "Session de paiement invalide.": "Invalid payment session.",
  "Paiement non abouti.": "Payment not completed.",
};

const normalize = (value) => String(value || '').replace(/[’‘]/g, "'").trim();
const NORMALIZED = new Map(Object.entries(EXACT).map(([fr, en]) => [normalize(fr), en]));

// Messages à valeurs variables : motif français → traduction
const PATTERNS = [
  [/^Accès refusé\. Ce service requiert l'un des rôles suivants : (.+)\.$/, (m) => `Access denied. This service requires one of the following roles: ${m[1]}.`],
  [/^Ce document compte trop de pages \(max (\d+) pour l'édition\)\.$/, (m) => `This document has too many pages (max ${m[1]} for editing).`],
  [/^Ce véhicule est rattaché à une session\. Confirmez que vous souhaitez le détacher de la session avant de (modifier|supprimer) ce dossier\.$/, (m) => `This vehicle is attached to a session. Confirm that you want to detach it from the session before you ${m[1] === 'modifier' ? 'edit' : 'delete'} this file.`],
  [/^La prolongation doit être comprise entre 1 et (\d+) heures\.$/, (m) => `The extension must be between 1 and ${m[1]} hours.`],
  [/^Le dossier est incomplet pour être soumis à validation\. Champs manquants : (.+)\.$/, (m) => `The file is incomplete and cannot be submitted for validation. Missing fields: ${m[1]}.`],
  [/^Un dossier véhicule existe déjà avec l'immatriculation « (.+) »\.$/, (m) => `A vehicle file already exists with the registration number “${m[1]}”.`],
  [/^L'e-mail n'a pas pu être envoyé à (.+)\. La décision n'a pas été appliquée : vérifiez la configuration SMTP puis réessayez\.$/, (m) => `The e-mail could not be sent to ${m[1]}. The decision was not applied: check the SMTP configuration and try again.`],
];

const translateMessage = (message, language) => {
  if (language !== 'en' || typeof message !== 'string') return message;
  const key = normalize(message);
  if (NORMALIZED.has(key)) return NORMALIZED.get(key);
  for (const [pattern, build] of PATTERNS) {
    const match = key.match(pattern);
    if (match) return build(match);
  }
  return message;
};

/** Langue demandée : en-tête X-Language du client, sinon langue du compte connecté, sinon Accept-Language. */
const requestLanguage = (req) => {
  const raw = req.headers?.['x-language'] || req.user?.language || req.headers?.['accept-language'] || 'fr';
  return String(raw).toLowerCase().startsWith('en') ? 'en' : 'fr';
};

/** Middleware : traduit le `message` des réponses (erreurs et confirmations) quand l'anglais est demandé. */
const localizeErrorResponses = (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && typeof body.message === 'string') {
      const language = requestLanguage(req);
      if (language === 'en') body = { ...body, message: translateMessage(body.message, language) };
    }
    return originalJson(body);
  };
  next();
};

module.exports = { translateMessage, requestLanguage, localizeErrorResponses };

/** Choisit le texte selon la langue du compte destinataire (français par défaut). */
const pickLanguage = (user, fr, en) => (String(user?.language || '').toLowerCase() === 'en' ? en : fr);
module.exports.pickLanguage = pickLanguage;
