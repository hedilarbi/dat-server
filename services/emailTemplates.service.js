const SUPPORTED_LANGUAGES = ['fr', 'en'];
const CLIENT_BASE_URL = process.env.CLIENT_BASE_URL || 'https://dealautopro.com';

const normalizeLanguage = (language) => {
  return SUPPORTED_LANGUAGES.includes(language) ? language : 'fr';
};

const layout = ({ heading, body, footer }) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #DCD7CB; background-color: #FBFAF7;">
    <h2 style="color: #13243C; border-bottom: 2px solid #D9704F; padding-bottom: 10px;">${heading}</h2>
    ${body}
    <hr style="border: 0; border-top: 1px solid #DCD7CB; margin: 20px 0;" />
    <p style="color: #5A5E66; font-size: 12px;">${footer}</p>
  </div>
`;

const otpEmail = ({ language, firstName, lastName, otpCode, resend = false }) => {
  const lang = normalizeLanguage(language);
  const copy = {
    fr: {
      subject: resend ? 'Nouveau code de vérification - DealAutoPro' : 'Vérification de votre compte - DealAutoPro',
      heading: resend ? 'Nouveau code de vérification' : 'Vérification de votre e-mail',
      hello: `Bonjour ${firstName} ${lastName},`,
      intro: resend
        ? 'Suite à votre demande, voici votre nouveau code de vérification :'
        : 'Merci de vous inscrire sur DealAutoPro. Pour valider votre adresse e-mail, veuillez utiliser le code de vérification suivant :',
      confidentiality: 'Ce code est confidentiel et expirera dans 15 minutes.',
      text: resend
        ? `Votre nouveau code de vérification OTP est : ${otpCode}. Ce code expire dans 15 minutes.`
        : `Votre code de vérification OTP est : ${otpCode}. Ce code expire dans 15 minutes.`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: resend ? 'New verification code - DealAutoPro' : 'Verify your account - DealAutoPro',
      heading: resend ? 'New verification code' : 'Email verification',
      hello: `Hello ${firstName} ${lastName},`,
      intro: resend
        ? 'Here is your new verification code:'
        : 'Thank you for registering on DealAutoPro. To validate your email address, use the following verification code:',
      confidentiality: 'This code is confidential and expires in 15 minutes.',
      text: resend
        ? `Your new OTP verification code is: ${otpCode}. This code expires in 15 minutes.`
        : `Your OTP verification code is: ${otpCode}. This code expires in 15 minutes.`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.intro}</p>
        <div style="background-color: #F1EFE8; border: 1px dashed #B3893F; padding: 15px; text-align: center; margin: 20px 0; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #13243C; font-family: monospace;">
          ${otpCode}
        </div>
        <p style="color: #9A917D; font-size: 12px;">${copy.confidentiality}</p>
      `
    })
  };
};

const passwordResetEmail = ({ language, firstName, lastName, otpCode }) => {
  const lang = normalizeLanguage(language);
  const copy = {
    fr: {
      subject: 'Réinitialisation de votre mot de passe - DealAutoPro',
      heading: 'Réinitialisation de mot de passe',
      hello: `Bonjour ${firstName} ${lastName},`,
      intro: 'Vous avez demandé la réinitialisation de votre mot de passe. Voici votre code de vérification :',
      confidentiality: 'Ce code est confidentiel et expirera dans 15 minutes. Si vous n\'êtes pas à l\'origine de cette demande, ignorez cet e-mail.',
      text: `Votre code de réinitialisation de mot de passe est : ${otpCode}. Ce code expire dans 15 minutes.`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: 'Reset your password - DealAutoPro',
      heading: 'Password reset',
      hello: `Hello ${firstName} ${lastName},`,
      intro: 'You requested a password reset. Here is your verification code:',
      confidentiality: 'This code is confidential and expires in 15 minutes. If you did not request this, please ignore this email.',
      text: `Your password reset code is: ${otpCode}. This code expires in 15 minutes.`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.intro}</p>
        <div style="background-color: #F1EFE8; border: 1px dashed #B3893F; padding: 15px; text-align: center; margin: 20px 0; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #13243C; font-family: monospace;">
          ${otpCode}
        </div>
        <p style="color: #9A917D; font-size: 12px;">${copy.confidentiality}</p>
      `
    })
  };
};

const approvalEmail = (user) => {
  const lang = normalizeLanguage(user.language);
  const copy = {
    fr: {
      subject: 'Votre compte a été validé ! - DealAutoPro',
      heading: 'Votre compte est activé',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      line1: 'Nous avons le plaisir de vous informer que vos documents professionnels ont été vérifiés et votre compte a été validé.',
      line2: 'Vous pouvez dès à présent vous connecter sur votre espace pour commencer à utiliser nos services.',
      cta: 'Se connecter',
      text: 'Félicitations, votre compte professionnel a été validé par notre équipe. Vous pouvez maintenant accéder à la plateforme.',
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: 'Your account has been approved - DealAutoPro',
      heading: 'Your account is active',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      line1: 'We are pleased to inform you that your business documents have been reviewed and your account has been approved.',
      line2: 'You can now sign in to your workspace and start using the platform.',
      cta: 'Sign in',
      text: 'Congratulations, your business account has been approved by our team. You can now access the platform.',
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line2}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="https://dealautopro.com/login" style="background-color: #13243C; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

const rejectionEmail = ({ user, reasonsText, reasonsPlain, comment }) => {
  const lang = normalizeLanguage(user.language);
  const copy = {
    fr: {
      subject: 'Action requise : Inscription refusée - DealAutoPro',
      heading: "Dossier d'inscription incomplet ou non valide",
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      line1: "Après examen de vos documents professionnels, votre inscription ne peut pas être validée en l'état.",
      reasons: 'Motifs de refus :',
      comment: "Commentaire de l'administrateur :",
      line2: 'Pour corriger ces éléments, veuillez vous connecter sur votre espace et mettre à jour votre dossier.',
      cta: 'Accéder à mon espace',
      text: `Votre inscription a été refusée pour les raisons suivantes : ${reasonsPlain}. Commentaire : ${comment || ''}. Veuillez corriger votre dossier sur votre espace.`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: 'Action required: Registration rejected - DealAutoPro',
      heading: 'Registration file incomplete or invalid',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      line1: 'After reviewing your business documents, your registration cannot be approved in its current state.',
      reasons: 'Rejection reasons:',
      comment: 'Administrator comment:',
      line2: 'To correct these items, please sign in to your workspace and update your file.',
      cta: 'Open my workspace',
      text: `Your registration was rejected for the following reasons: ${reasonsPlain}. Comment: ${comment || ''}. Please update your file in your workspace.`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        <div style="background-color: #F1EFE8; border-left: 4px solid #9A3B2F; padding: 15px; margin: 20px 0;">
          <strong style="color: #9A3B2F;">${copy.reasons}</strong><br>
          <p style="color: #1A2230; margin: 5px 0;">${reasonsText}</p>
          ${comment ? `<br><strong style="color: #5A5E66;">${copy.comment}</strong><p style="color: #1A2230; margin: 5px 0; font-style: italic;">"${comment}"</p>` : ''}
        </div>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line2}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="https://dealautopro.com/login" style="background-color: #13243C; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

const correctionEmail = ({ user, reasonsText, reasonsPlain, comment }) => {
  const lang = normalizeLanguage(user.language);
  const correctionPath = user.role === 'vendeur' ? '/vendeur/tableau-de-bord' : '/profil';
  const correctionUrl = `${CLIENT_BASE_URL}${correctionPath}#correction-form`;
  const copy = {
    fr: {
      subject: 'Action requise : Correction de votre dossier - DealAutoPro',
      heading: 'Correction demandée sur votre dossier',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      line1: "Après examen de vos documents professionnels, quelques éléments doivent être corrigés avant validation de votre inscription.",
      reasons: 'Éléments à corriger :',
      comment: "Commentaire de l'administrateur :",
      line2: 'Merci de cliquer sur le lien ci-dessous pour corriger votre dossier avec les éléments demandés.',
      cta: 'Corriger mon dossier',
      text: `Une correction est demandée sur votre dossier pour les raisons suivantes : ${reasonsPlain}. Commentaire : ${comment || ''}. Corrigez votre dossier ici : ${correctionUrl}`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: 'Action required: Update your file - DealAutoPro',
      heading: 'Correction requested on your file',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      line1: 'After reviewing your business documents, a few items need to be corrected before your registration can be approved.',
      reasons: 'Items to correct:',
      comment: 'Administrator comment:',
      line2: 'Please click the link below to fix your file with the requested items.',
      cta: 'Fix my file',
      text: `A correction is requested on your file for the following reasons: ${reasonsPlain}. Comment: ${comment || ''}. Fix your file here: ${correctionUrl}`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        <div style="background-color: #F1EFE8; border-left: 4px solid #B3893F; padding: 15px; margin: 20px 0;">
          <strong style="color: #B3893F;">${copy.reasons}</strong><br>
          <p style="color: #1A2230; margin: 5px 0;">${reasonsText}</p>
          ${comment ? `<br><strong style="color: #5A5E66;">${copy.comment}</strong><p style="color: #1A2230; margin: 5px 0; font-style: italic;">"${comment}"</p>` : ''}
        </div>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line2}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${correctionUrl}" style="background-color: #13243C; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

const dossierApprovalEmail = ({ user, vehicleLabel }) => {
  const lang = normalizeLanguage(user.language);
  const copy = {
    fr: {
      subject: 'Votre dossier véhicule a été validé ! - DealAutoPro',
      heading: 'Dossier véhicule validé',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      line1: `Nous avons le plaisir de vous informer que votre dossier véhicule "${vehicleLabel}" a été vérifié et validé.`,
      line2: 'Il sera prochainement programmé dans une session d\'appel d\'offres.',
      cta: 'Voir mes dossiers',
      text: `Votre dossier véhicule "${vehicleLabel}" a été validé par notre équipe.`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: 'Your vehicle file has been approved - DealAutoPro',
      heading: 'Vehicle file approved',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      line1: `We are pleased to inform you that your vehicle file "${vehicleLabel}" has been reviewed and approved.`,
      line2: 'It will soon be scheduled in an auction session.',
      cta: 'View my files',
      text: `Your vehicle file "${vehicleLabel}" has been approved by our team.`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line2}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="https://dealautopro.com/vendeur/dossiers" style="background-color: #13243C; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

const dossierRejectionEmail = ({ user, vehicleLabel, reasonsText, reasonsPlain, comment }) => {
  const lang = normalizeLanguage(user.language);
  const copy = {
    fr: {
      subject: 'Action requise : Dossier véhicule refusé - DealAutoPro',
      heading: 'Dossier véhicule refusé',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      line1: `Après examen, votre dossier véhicule "${vehicleLabel}" ne peut pas être validé en l'état.`,
      reasons: 'Motifs de refus :',
      comment: "Commentaire de l'administrateur :",
      line2: 'Pour corriger ces éléments, veuillez vous connecter sur votre espace.',
      cta: 'Accéder à mon espace',
      text: `Votre dossier véhicule "${vehicleLabel}" a été refusé pour les raisons suivantes : ${reasonsPlain}. Commentaire : ${comment || ''}.`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: 'Action required: Vehicle file rejected - DealAutoPro',
      heading: 'Vehicle file rejected',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      line1: `After review, your vehicle file "${vehicleLabel}" cannot be approved in its current state.`,
      reasons: 'Rejection reasons:',
      comment: 'Administrator comment:',
      line2: 'To correct these items, please sign in to your workspace.',
      cta: 'Open my workspace',
      text: `Your vehicle file "${vehicleLabel}" was rejected for the following reasons: ${reasonsPlain}. Comment: ${comment || ''}.`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        <div style="background-color: #F1EFE8; border-left: 4px solid #9A3B2F; padding: 15px; margin: 20px 0;">
          <strong style="color: #9A3B2F;">${copy.reasons}</strong><br>
          <p style="color: #1A2230; margin: 5px 0;">${reasonsText}</p>
          ${comment ? `<br><strong style="color: #5A5E66;">${copy.comment}</strong><p style="color: #1A2230; margin: 5px 0; font-style: italic;">"${comment}"</p>` : ''}
        </div>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line2}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="https://dealautopro.com/vendeur/dossiers" style="background-color: #13243C; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

const dossierCorrectionEmail = ({ user, vehicleLabel, reasonsText, reasonsPlain, comment }) => {
  const lang = normalizeLanguage(user.language);
  const copy = {
    fr: {
      subject: 'Action requise : Correction de votre dossier véhicule - DealAutoPro',
      heading: 'Correction demandée sur votre dossier véhicule',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      line1: `Après examen, quelques éléments de votre dossier véhicule "${vehicleLabel}" doivent être corrigés avant validation.`,
      reasons: 'Éléments à corriger :',
      comment: "Commentaire de l'administrateur :",
      line2: 'Merci de vous connecter sur votre espace et de mettre à jour votre dossier avec les éléments demandés.',
      cta: 'Accéder à mon espace',
      text: `Une correction est demandée sur votre dossier véhicule "${vehicleLabel}" pour les raisons suivantes : ${reasonsPlain}. Commentaire : ${comment || ''}.`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: 'Action required: Update your vehicle file - DealAutoPro',
      heading: 'Correction requested on your vehicle file',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      line1: `After review, a few items in your vehicle file "${vehicleLabel}" need to be corrected before approval.`,
      reasons: 'Items to correct:',
      comment: 'Administrator comment:',
      line2: 'Please sign in to your workspace and update your file with the requested items.',
      cta: 'Open my workspace',
      text: `A correction is requested on your vehicle file "${vehicleLabel}" for the following reasons: ${reasonsPlain}. Comment: ${comment || ''}.`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        <div style="background-color: #F1EFE8; border-left: 4px solid #B3893F; padding: 15px; margin: 20px 0;">
          <strong style="color: #B3893F;">${copy.reasons}</strong><br>
          <p style="color: #1A2230; margin: 5px 0;">${reasonsText}</p>
          ${comment ? `<br><strong style="color: #5A5E66;">${copy.comment}</strong><p style="color: #1A2230; margin: 5px 0; font-style: italic;">"${comment}"</p>` : ''}
        </div>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line2}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="https://dealautopro.com/vendeur/dossiers" style="background-color: #13243C; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

// Slug de la page de détail d'une vente gagnée, par langue (miroir de client/app/routing.ts)
const WON_SALE_PATH = { fr: '/fr/acheteur/tableau-de-bord/mes-vehicules', en: '/en/buyer/dashboard/my-vehicles' };
const SELLER_SALES_PATH = { fr: '/fr/vendeur/ventes', en: '/en/seller/sales' };

/**
 * Exprime un délai en heures sous une forme lisible : « 48 heures (2 jours) ».
 */
const formatDeadline = (hours, lang) => {
  const days = Math.floor(hours / 24);
  const hourLabel = lang === 'fr' ? 'heures' : 'hours';
  if (days < 1) return `${hours} ${hourLabel}`;
  const dayLabel = lang === 'fr' ? (days > 1 ? 'jours' : 'jour') : (days > 1 ? 'days' : 'day');
  return `${hours} ${hourLabel} (${days} ${dayLabel})`;
};

/**
 * Carte véhicule reprise dans l'e-mail : photo de couverture, marque, modèle et année.
 * La photo est omise si le dossier n'en a aucune, plutôt que d'afficher une image cassée.
 */
const vehicleCard = (photoUrl, title, subtitle) => `
  <table style="width: 100%; border-collapse: collapse; background-color: #FFFFFF; border: 1px solid #DCD7CB; border-radius: 8px; margin: 18px 0;">
    <tr>
      ${photoUrl ? `<td style="width: 140px; padding: 12px;">
        <img src="${photoUrl}" alt="${title}" width="128" style="width: 128px; height: 96px; object-fit: cover; border-radius: 6px; display: block;" />
      </td>` : ''}
      <td style="padding: 12px; vertical-align: middle;">
        <div style="color: #13243C; font-size: 17px; font-weight: bold; text-transform: uppercase;">${title}</div>
        <div style="color: #5A5E66; font-size: 13px; margin-top: 4px;">${subtitle}</div>
      </td>
    </tr>
  </table>
`;

const saleWonEmail = ({ user, brand, model, year, photoUrl, sessionName, amount, saleId, deadlineHours }) => {
  const lang = normalizeLanguage(user.language);
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const url = `${CLIENT_BASE_URL}${WON_SALE_PATH[lang]}/${saleId}`;
  const price = Number(amount).toLocaleString(locale);
  const vehicleLabel = [brand, model].filter(Boolean).join(' ') || (lang === 'fr' ? 'Véhicule' : 'Vehicle');
  const delay = formatDeadline(deadlineHours, lang);

  const copy = {
    fr: {
      subject: `Vous avez remporté ${vehicleLabel} ! - DealAutoPro`,
      heading: 'Vous avez remporté cette enchère',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Année ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `Votre offre de ${price} € est la meilleure offre retenue à la clôture de ${sessionName}.`,
      line2: 'Connectez-vous à la plateforme pour entamer votre procédure d\'achat. Elle commence par le paiement de la commission plateforme.',
      line3: `Vous disposez de ${delay} pour finaliser cette première étape. Passé ce délai, le véhicule sera attribué à l'offre suivante.`,
      cta: 'Entamer ma procédure d\'achat',
      text: `Vous avez remporté ${vehicleLabel}${year ? ` (${year})` : ''} lors de ${sessionName}, avec une offre de ${price} €. `
        + `Connectez-vous pour entamer votre procédure d'achat : vous avez ${delay} pour payer la commission plateforme. ${url}`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: `You won ${vehicleLabel}! - DealAutoPro`,
      heading: 'You won this auction',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Year ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `Your bid of €${price} is the winning bid at the close of ${sessionName}.`,
      line2: 'Sign in to the platform to start your purchase procedure. It begins with paying the platform commission.',
      line3: `You have ${delay} to complete this first step. After that, the vehicle will be awarded to the next bidder.`,
      cta: 'Start my purchase',
      text: `You won ${vehicleLabel}${year ? ` (${year})` : ''} in ${sessionName}, with a bid of €${price}. `
        + `Sign in to start your purchase procedure: you have ${delay} to pay the platform commission. ${url}`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        ${vehicleCard(photoUrl, vehicleLabel, copy.subtitle)}
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line2}</p>
        <p style="color: #B04A2C; font-size: 14px; font-weight: bold;">${copy.line3}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${url}" style="background-color: #D9704F; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

// Libellés des étapes de la procédure d'achat (miroir de PURCHASE_STEPS du modèle Sale)
const STEP_LABELS = {
  fr: {
    commission: 'Paiement de la commission',
    virement: 'Virement au vendeur',
    certificats: 'Certificats de cession',
    signature: 'Signature et dépôt des documents',
    validation_vendeur: 'Validation par le vendeur',
    enlevement: 'Enlèvement du véhicule',
  },
  en: {
    commission: 'Commission payment',
    virement: 'Transfer to the seller',
    certificats: 'Transfer certificates',
    signature: 'Sign and upload documents',
    validation_vendeur: 'Seller confirmation',
    enlevement: 'Vehicle collection',
  },
};

/** Durée restante exprimée en heures et minutes. */
const formatRemaining = (milliseconds, lang) => {
  const totalMinutes = Math.max(0, Math.round(milliseconds / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (lang === 'fr') return hours > 0 ? `${hours} h ${String(minutes).padStart(2, '0')}` : `${minutes} minutes`;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}` : `${minutes} minutes`;
};

/**
 * Rappel envoyé à l'acheteur lorsqu'une part définie du délai de l'étape courante s'est écoulée.
 */
const saleStepReminderEmail = ({ user, brand, model, year, photoUrl, sessionName, stepKey, saleId, remainingMs }) => {
  const lang = normalizeLanguage(user.language);
  const url = `${CLIENT_BASE_URL}${WON_SALE_PATH[lang]}/${saleId}`;
  const vehicleLabel = [brand, model].filter(Boolean).join(' ') || (lang === 'fr' ? 'Véhicule' : 'Vehicle');
  const stepLabel = STEP_LABELS[lang][stepKey] || stepKey;
  const remaining = formatRemaining(remainingMs, lang);

  const copy = {
    fr: {
      subject: `Rappel : ${remaining} pour finaliser « ${stepLabel} » - DealAutoPro`,
      heading: 'Votre procédure d’achat attend une action',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Année ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `L'étape « ${stepLabel} » de votre achat n'est pas encore finalisée.`,
      line2: `Il vous reste ${remaining} pour la terminer.`,
      line3: 'Passé ce délai, vous perdrez l\'attribution du véhicule et il sera proposé à l\'offre suivante.',
      cta: 'Reprendre ma procédure',
      text: `Rappel : il vous reste ${remaining} pour finaliser l'étape « ${stepLabel} » de votre achat (${vehicleLabel}). ${url}`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: `Reminder: ${remaining} left to complete "${stepLabel}" - DealAutoPro`,
      heading: 'Your purchase is waiting for an action',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Year ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `The "${stepLabel}" step of your purchase is not complete yet.`,
      line2: `You have ${remaining} left to finish it.`,
      line3: 'After that, you will lose the vehicle and it will be offered to the next bidder.',
      cta: 'Resume my purchase',
      text: `Reminder: you have ${remaining} left to complete the "${stepLabel}" step of your purchase (${vehicleLabel}). ${url}`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        ${vehicleCard(photoUrl, vehicleLabel, copy.subtitle)}
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        <p style="color: #13243C; font-size: 15px; font-weight: bold;">${copy.line2}</p>
        <p style="color: #B04A2C; font-size: 14px;">${copy.line3}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${url}" style="background-color: #D9704F; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

/**
 * Alerte envoyée à l'administrateur lorsqu'un acheteur a dépassé 80% du délai
 * pour l'étape de paiement du véhicule (étape 2).
 */
const adminLatePaymentAlertEmail = ({ vehicleLabel, buyerName, buyerEmail, saleId, remainingMs }) => {
  const url = `${process.env.ADMIN_URL || 'http://localhost:3002'}/ventes`;
  const remainingHours = Math.max(0, Math.round(remainingMs / (1000 * 60 * 60)));

  return {
    subject: `ALERTE : Paiement véhicule en retard (${vehicleLabel})`,
    text: `Le paiement pour le véhicule ${vehicleLabel} par l'acheteur ${buyerName} (${buyerEmail}) n'a toujours pas été reçu. Il ne reste que ${remainingHours} heures avant l'annulation automatique. Consultez la vente : ${url}`,
    html: layout({
      heading: 'Alerte : Paiement Critique',
      footer: 'Système de supervision DealAutoPro',
      body: `
        <p style="color: #1A2230; font-size: 16px;">Bonjour,</p>
        <p style="color: #5A5E66; font-size: 14px;">Une vente nécessite potentiellement votre attention.</p>
        <div style="background-color: #fff7f1; border-left: 4px solid #B04A2C; padding: 15px; margin: 20px 0;">
          <p style="margin: 0 0 10px 0;"><strong>Véhicule :</strong> ${vehicleLabel}</p>
          <p style="margin: 0 0 10px 0;"><strong>Acheteur :</strong> ${buyerName} (${buyerEmail})</p>
          <p style="margin: 0; color: #B04A2C; font-weight: bold;">Le délai autorisé a dépassé les 80%.</p>
          <p style="margin: 5px 0 0 0;">Temps restant avant annulation automatique : ~${remainingHours} heure(s).</p>
        </div>
        <p style="color: #5A5E66; font-size: 14px;">Vous pouvez contacter l'acheteur ou préparer la réattribution de cette vente.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${url}" style="background-color: #B04A2C; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Voir les ventes</a>
        </div>
      `
    })
  };
};

/**
 * Information envoyée à l'acheteur écarté : le délai de l'étape est dépassé,
 * le véhicule passe au candidat suivant de la liste d'attente.
 */
/**
 * Prévient l'acheteur écarté qu'il a perdu son attribution faute d'avoir finalisé une étape
 * à temps. `suspended` distingue les deux cas : le tout premier gagnant qui ne paie pas sa
 * commission (ou ne fait pas le virement) à temps voit son compte suspendu, tandis qu'un
 * gagnant réattribué qui échoue à son tour sur la commission n'est jamais suspendu — il perd
 * simplement le véhicule, sans pénalité.
 */
const saleWinnerRemovedEmail = ({ user, brand, model, year, photoUrl, sessionName, stepKey, suspended }) => {
  const lang = normalizeLanguage(user.language);
  const vehicleLabel = [brand, model].filter(Boolean).join(' ') || (lang === 'fr' ? 'Véhicule' : 'Vehicle');
  const stepLabel = STEP_LABELS[lang][stepKey] || stepKey;

  const copy = {
    fr: {
      subject: suspended
        ? `Attribution retirée et compte suspendu pour ${vehicleLabel} - DealAutoPro`
        : `Attribution retirée pour ${vehicleLabel} - DealAutoPro`,
      heading: suspended ? 'Attribution retirée & Compte suspendu' : 'Attribution retirée',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Année ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `Le délai imparti pour l'étape « ${stepLabel} » est écoulé sans que celle-ci ait été finalisée.`,
      line2: `L'attribution de ce véhicule vous a donc été retirée et celui-ci est proposé au candidat suivant.`,
      line3: suspended
        ? `Conformément à nos règles de fonctionnement, votre compte a été suspendu suite à ce dépassement de délai. Vos accès aux enchères sont temporairement bloqués. Pour régulariser votre situation et réactiver votre compte, veuillez vous connecter à votre espace afin de régler les frais de dossier dus.`
        : `Aucune pénalité ne vous est appliquée : votre compte reste actif et vous pouvez continuer à enchérir normalement sur la plateforme.`,
      text: suspended
        ? `Le délai de l'étape « ${stepLabel} » est écoulé : l'attribution de ${vehicleLabel} vous a été retirée et votre compte a été suspendu. Pour réactiver votre compte, rendez-vous sur votre espace pour régler les frais dus.`
        : `Le délai de l'étape « ${stepLabel} » est écoulé : l'attribution de ${vehicleLabel} vous a été retirée, sans pénalité. Votre compte reste actif.`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: suspended
        ? `Award withdrawn and account suspended for ${vehicleLabel} - DealAutoPro`
        : `Award withdrawn for ${vehicleLabel} - DealAutoPro`,
      heading: suspended ? 'Award Withdrawn & Account Suspended' : 'Award Withdrawn',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Year ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `The deadline for the "${stepLabel}" step has passed without it being completed.`,
      line2: `This vehicle has therefore been withdrawn from you and offered to the next candidate.`,
      line3: suspended
        ? `In accordance with our platform rules, your account has been suspended following this missed deadline. Your bidding access is currently blocked. To settle your account and reactivate your profile, please log in to your dashboard to pay the pending processing fees.`
        : `No penalty applies: your account remains active and you can keep bidding normally on the platform.`,
      text: suspended
        ? `The deadline for the "${stepLabel}" step has passed: ${vehicleLabel} has been withdrawn from you and your account has been suspended. Please log in to your account to settle the pending fees and reactivate your profile.`
        : `The deadline for the "${stepLabel}" step has passed: ${vehicleLabel} has been withdrawn from you, with no penalty. Your account remains active.`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        ${vehicleCard(photoUrl, vehicleLabel, copy.subtitle)}
        <p style="color: #B04A2C; font-size: 14px; font-weight: bold;">${copy.line1}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line2}</p>
        <p style="color: ${suspended ? '#B04A2C' : '#5A5E66'}; font-size: 14px; font-weight: 500;">${copy.line3}</p>
      `
    })
  };
};

/**
 * Enchère clôturée sans preneur : le prix de réserve n'a pas été atteint.
 *
 * Le vendeur reçoit la meilleure offre reçue quand il y en a eu une — c'est l'information
 * qui lui permet de décider s'il republie au même prix de réserve ou plus bas. Sans aucune
 * offre, le message le dit franchement plutôt que d'afficher un montant vide.
 */
const saleUnsoldSellerEmail = ({ user, brand, model, year, photoUrl, sessionName, reservePrice, bestOffer, offerCount }) => {
  const lang = normalizeLanguage(user.language);
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const url = `${CLIENT_BASE_URL}${SELLER_SALES_PATH[lang]}`;
  const vehicleLabel = [brand, model].filter(Boolean).join(' ') || (lang === 'fr' ? 'Véhicule' : 'Vehicle');
  const hasOffers = Number(offerCount) > 0 && Number.isFinite(Number(bestOffer));
  const best = hasOffers ? Number(bestOffer).toLocaleString(locale) : null;
  const reserve = Number.isFinite(Number(reservePrice)) ? Number(reservePrice).toLocaleString(locale) : null;

  const copy = {
    fr: {
      subject: `Enchère clôturée : ${vehicleLabel} n'a pas trouvé preneur - DealAutoPro`,
      heading: 'Votre véhicule n\'a pas trouvé preneur',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Année ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `L'enchère sur votre véhicule est clôturée à l'issue de ${sessionName}. Le prix de réserve n'a pas été atteint : aucun acheteur n'a été désigné.`,
      offersLabel: hasOffers
        ? `Meilleure offre reçue (${offerCount} offre${Number(offerCount) > 1 ? 's' : ''})`
        : 'Offres reçues',
      offersValue: hasOffers ? `${best} €` : 'Aucune offre',
      reserveLabel: 'Votre prix de réserve',
      line2: hasOffers
        ? 'Les offres reçues sont restées sous votre prix de réserve. Vous pouvez republier le véhicule dans une prochaine session, en ajustant si besoin ce prix.'
        : 'Aucune offre n\'a été déposée pendant cette session. Vous pouvez republier le véhicule dans une prochaine session.',
      line3: 'Votre véhicule est de nouveau disponible : contactez-nous pour le replacer en vente.',
      cta: 'Suivre mes ventes',
      text: `L'enchère sur ${vehicleLabel} est clôturée (${sessionName}) sans atteindre le prix de réserve${reserve ? ` de ${reserve} €` : ''}. ${hasOffers ? `Meilleure offre reçue : ${best} €.` : 'Aucune offre reçue.'} ${url}`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: `Auction closed: ${vehicleLabel} found no buyer - DealAutoPro`,
      heading: 'Your vehicle found no buyer',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Year ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `The auction on your vehicle closed at the end of ${sessionName}. The reserve price was not met, so no buyer was appointed.`,
      offersLabel: hasOffers
        ? `Highest bid received (${offerCount} bid${Number(offerCount) > 1 ? 's' : ''})`
        : 'Bids received',
      offersValue: hasOffers ? `€${best}` : 'No bid',
      reserveLabel: 'Your reserve price',
      line2: hasOffers
        ? 'The bids received stayed below your reserve price. You can relist the vehicle in a future session, adjusting that price if needed.'
        : 'No bid was placed during this session. You can relist the vehicle in a future session.',
      line3: 'Your vehicle is available again: contact us to put it back up for sale.',
      cta: 'Track my sales',
      text: `The auction on ${vehicleLabel} closed (${sessionName}) without meeting the reserve price${reserve ? ` of €${reserve}` : ''}. ${hasOffers ? `Highest bid received: €${best}.` : 'No bid received.'} ${url}`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        ${vehicleCard(photoUrl, vehicleLabel, copy.subtitle)}
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        <div style="background-color: #FFFFFF; border: 1px solid #DCD7CB; border-radius: 8px; padding: 16px; text-align: center; margin: 18px 0;">
          <div style="color: #5A5E66; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">${copy.offersLabel}</div>
          <div style="color: #13243C; font-size: 26px; font-weight: bold; margin-top: 6px;">${copy.offersValue}</div>
          ${reserve ? `<div style="color: #5A5E66; font-size: 12px; margin-top: 10px;">${copy.reserveLabel} : <strong style="color: #13243C;">${reserve} €</strong></div>` : ''}
        </div>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line2}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line3}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${url}" style="background-color: #13243C; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

const saleAwardedSellerEmail = ({ user, brand, model, year, photoUrl, sessionName, amount, saleId }) => {
  const lang = normalizeLanguage(user.language);
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const url = `${CLIENT_BASE_URL}${SELLER_SALES_PATH[lang]}/${saleId}`;
  const vehicleLabel = [brand, model].filter(Boolean).join(' ') || (lang === 'fr' ? 'Véhicule' : 'Vehicle');
  const price = Number(amount).toLocaleString(locale);

  const copy = {
    fr: {
      subject: `Un meilleur offrant pour votre ${vehicleLabel} - DealAutoPro`,
      heading: 'Votre véhicule a un meilleur offrant',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Année ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `La session ${sessionName} est clôturée et votre véhicule a un meilleur offrant.`,
      offerLabel: 'Meilleure offre',
      line2: 'Entre la vérification de l\'acheteur et la réception de son virement, prévoyez un délai pouvant aller jusqu\'à 5 jours.',
      line3: 'Vous pouvez suivre la vente et confirmer la réception du virement directement depuis votre espace vendeur.',
      cta: 'Suivre et confirmer le virement',
      text: `La session ${sessionName} est clôturée et votre ${vehicleLabel} a un meilleur offrant de ${price} €. Entre la vérification de l'acheteur et la réception de son virement, prévoyez jusqu'à 5 jours. Suivez la vente et confirmez la réception du virement ici : ${url}`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: `A highest bidder for your ${vehicleLabel} - DealAutoPro`,
      heading: 'Your vehicle has a highest bidder',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Year ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `The ${sessionName} session has closed and your vehicle has a highest bidder.`,
      offerLabel: 'Highest bid',
      line2: 'Please allow up to 5 days between buyer verification and receipt of their bank transfer.',
      line3: 'You can track the sale and confirm receipt of the transfer directly from your seller workspace.',
      cta: 'Track and confirm transfer',
      text: `The ${sessionName} session has closed and your ${vehicleLabel} has a highest bid of €${price}. Please allow up to 5 days between buyer verification and receipt of the transfer. Track the sale and confirm receipt here: ${url}`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        ${vehicleCard(photoUrl, vehicleLabel, copy.subtitle)}
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        <div style="background-color: #FFFFFF; border: 1px solid #DCD7CB; border-radius: 8px; padding: 16px; text-align: center; margin: 18px 0;">
          <div style="color: #5A5E66; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">${copy.offerLabel}</div>
          <div style="color: #13243C; font-size: 26px; font-weight: bold; margin-top: 6px;">${price} €</div>
        </div>
        <p style="color: #B3893F; font-size: 14px; font-weight: bold;">${copy.line2}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line3}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${url}" style="background-color: #13243C; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

/**
 * Prévenir l'acheteur que le certificat de cession est prêt : il doit le télécharger,
 * le signer et le tamponner, puis le redéposer sur la plateforme.
 */
const saleCertificateReadyEmail = ({ user, brand, model, year, photoUrl, sessionName, saleId }) => {
  const lang = normalizeLanguage(user.language);
  const url = `${CLIENT_BASE_URL}${WON_SALE_PATH[lang]}/${saleId}`;
  const vehicleLabel = [brand, model].filter(Boolean).join(' ') || (lang === 'fr' ? 'Véhicule' : 'Vehicle');

  const copy = {
    fr: {
      subject: `Votre certificat de cession est prêt — ${vehicleLabel} - DealAutoPro`,
      heading: 'Votre certificat de cession est prêt',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Année ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: 'Le vendeur a confirmé avoir reçu votre virement. Le certificat de cession du véhicule a été généré et rattaché à votre vente.',
      line2: 'Il vous reste à le <strong>télécharger</strong>, le <strong>signer</strong> et le <strong>tamponner</strong>, puis à le <strong>redéposer</strong> sur la plateforme.',
      line3: 'Rendez-vous à l\'étape 3 de votre procédure d\'achat : vous y trouverez le document et l\'espace de dépôt.',
      cta: 'Télécharger et déposer le certificat',
      text: `Le vendeur a confirmé la réception de votre virement. Votre certificat de cession pour ${vehicleLabel} est prêt : téléchargez-le, signez-le, tamponnez-le puis redéposez-le sur la plateforme. ${url}`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: `Your transfer certificate is ready — ${vehicleLabel} - DealAutoPro`,
      heading: 'Your transfer certificate is ready',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Year ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: 'The seller confirmed receiving your transfer. The vehicle transfer certificate has been generated and attached to your sale.',
      line2: 'You now need to <strong>download</strong> it, <strong>sign</strong> and <strong>stamp</strong> it, then <strong>upload</strong> it back to the platform.',
      line3: 'Go to step 3 of your purchase: the document and the upload area are waiting there.',
      cta: 'Download and upload the certificate',
      text: `The seller confirmed receiving your transfer. Your transfer certificate for ${vehicleLabel} is ready: download it, sign and stamp it, then upload it back. ${url}`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        ${vehicleCard(photoUrl, vehicleLabel, copy.subtitle)}
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        <p style="color: #13243C; font-size: 14px;">${copy.line2}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line3}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${url}" style="background-color: #D9704F; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

/**
 * Prévenir le vendeur que l'acheteur a redéposé le certificat signé : il doit le vérifier
 * et confirmer qu'il est bien signé et tamponné.
 */
const saleSignedCertificateSellerEmail = ({ user, brand, model, year, photoUrl, sessionName, saleId }) => {
  const lang = normalizeLanguage(user.language);
  const url = `${CLIENT_BASE_URL}${SELLER_SALES_PATH[lang]}/${saleId}`;
  const vehicleLabel = [brand, model].filter(Boolean).join(' ') || (lang === 'fr' ? 'Véhicule' : 'Vehicle');

  const copy = {
    fr: {
      subject: `Certificat signé à vérifier — ${vehicleLabel} - DealAutoPro`,
      heading: 'Le certificat signé attend votre vérification',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Année ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `L'acheteur a déposé le certificat de cession de « ${vehicleLabel} », signé et tamponné.`,
      line2: 'Consultez le document depuis votre espace et confirmez qu\'il est bien signé et tamponné.',
      line3: 'Votre confirmation déclenche la suite de la procédure : la génération du mandat d\'enlèvement.',
      cta: 'Vérifier le certificat',
      text: `L'acheteur a déposé le certificat de cession signé et tamponné pour ${vehicleLabel}. Consultez-le et confirmez-le depuis votre espace : ${url}`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: `Signed certificate to review — ${vehicleLabel} - DealAutoPro`,
      heading: 'The signed certificate is waiting for your review',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Year ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `The buyer uploaded the transfer certificate for "${vehicleLabel}", signed and stamped.`,
      line2: 'Open the document from your workspace and confirm it is properly signed and stamped.',
      line3: 'Your confirmation triggers the next step: generating the collection mandate.',
      cta: 'Review the certificate',
      text: `The buyer uploaded the signed and stamped transfer certificate for ${vehicleLabel}. Review and confirm it from your workspace: ${url}`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        ${vehicleCard(photoUrl, vehicleLabel, copy.subtitle)}
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        <p style="color: #13243C; font-size: 14px; font-weight: bold;">${copy.line2}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line3}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${url}" style="background-color: #2F6F4F; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

// Libellés des motifs de refus d'un certificat signé (miroir du modèle Sale)
const REJECTION_REASON_LABELS = {
  fr: {
    tampon_manquant: 'Cachet manquant ou illisible',
    document_illisible: 'Document flou ou illisible',
    signature_manquante: 'Signature manquante',
    document_incomplet: 'Document incomplet (page manquante)',
    mauvais_document: 'Ce n’est pas le bon document',
    autre: 'Autre motif',
  },
  en: {
    tampon_manquant: 'Missing or unreadable stamp',
    document_illisible: 'Blurry or unreadable document',
    signature_manquante: 'Missing signature',
    document_incomplet: 'Incomplete document (missing page)',
    mauvais_document: 'This is not the right document',
    autre: 'Other reason',
  },
};

const rejectionBlock = (reasonLabel, comment, labels) => `
  <div style="background-color: #FDECE4; border-left: 4px solid #D9704F; padding: 14px 16px; margin: 18px 0;">
    <div style="color: #B04A2C; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-weight: bold;">${labels.reason}</div>
    <div style="color: #13243C; font-size: 15px; font-weight: bold; margin-top: 4px;">${reasonLabel}</div>
    ${comment ? `<div style="color: #5A5E66; font-size: 13px; margin-top: 8px;"><em>${labels.comment} :</em> ${comment}</div>` : ''}
  </div>
`;

/**
 * Prévenir l'acheteur que le certificat qu'il a déposé a été refusé par le vendeur,
 * avec le motif, et qu'il doit en redéposer un nouveau.
 */
const saleCertificateRejectedBuyerEmail = ({ user, brand, model, year, photoUrl, sessionName, saleId, reason, comment }) => {
  const lang = normalizeLanguage(user.language);
  const url = `${CLIENT_BASE_URL}${WON_SALE_PATH[lang]}/${saleId}`;
  const vehicleLabel = [brand, model].filter(Boolean).join(' ') || (lang === 'fr' ? 'Véhicule' : 'Vehicle');
  const reasonLabel = REJECTION_REASON_LABELS[lang][reason] || reason;

  const copy = {
    fr: {
      subject: `Certificat refusé — ${vehicleLabel} - DealAutoPro`,
      heading: 'Votre certificat doit être redéposé',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Année ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `Le vendeur a examiné le certificat de cession que vous avez déposé pour « ${vehicleLabel} » et ne peut pas le valider en l'état.`,
      line2: 'Merci de corriger ce point, puis de redéposer le document signé et tamponné depuis votre espace.',
      labels: { reason: 'Motif du refus', comment: 'Précision du vendeur' },
      cta: 'Redéposer le certificat',
      text: `Le vendeur a refusé le certificat déposé pour ${vehicleLabel}. Motif : ${reasonLabel}.${comment ? ` Précision : ${comment}.` : ''} Redéposez le document depuis votre espace : ${url}`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: `Certificate rejected — ${vehicleLabel} - DealAutoPro`,
      heading: 'Your certificate needs to be uploaded again',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Year ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `The seller reviewed the transfer certificate you uploaded for "${vehicleLabel}" and cannot validate it as it stands.`,
      line2: 'Please fix this point, then upload the signed and stamped document again from your workspace.',
      labels: { reason: 'Rejection reason', comment: 'Seller note' },
      cta: 'Upload the certificate again',
      text: `The seller rejected the certificate uploaded for ${vehicleLabel}. Reason: ${reasonLabel}.${comment ? ` Note: ${comment}.` : ''} Upload it again from your workspace: ${url}`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        ${vehicleCard(photoUrl, vehicleLabel, copy.subtitle)}
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        ${rejectionBlock(reasonLabel, comment, copy.labels)}
        <p style="color: #5A5E66; font-size: 14px;">${copy.line2}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${url}" style="background-color: #D9704F; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

/**
 * Informer l'administration qu'un certificat a été refusé, pour qu'elle puisse
 * intervenir si l'échange se bloque entre les deux parties.
 */
const saleCertificateRejectedAdminEmail = ({ user, vehicleLabel, sessionName, sellerName, buyerName, reason, comment }) => {
  const lang = normalizeLanguage(user?.language);
  const reasonLabel = REJECTION_REASON_LABELS[lang][reason] || reason;

  const copy = {
    fr: {
      subject: `[Admin] Certificat refusé — ${vehicleLabel} - DealAutoPro`,
      heading: 'Certificat de cession refusé',
      line1: `Le vendeur <strong>${sellerName}</strong> a refusé le certificat déposé par l'acheteur <strong>${buyerName}</strong>.`,
      line2: `Véhicule : ${vehicleLabel}${sessionName ? ` — ${sessionName}` : ''}.`,
      line3: 'L\'acheteur a été invité à redéposer un document conforme. Aucune action n\'est requise de votre part pour l\'instant.',
      labels: { reason: 'Motif du refus', comment: 'Précision du vendeur' },
      text: `Certificat refusé. Vendeur : ${sellerName}. Acheteur : ${buyerName}. Véhicule : ${vehicleLabel}. Motif : ${reasonLabel}.${comment ? ` Précision : ${comment}.` : ''}`,
      footer: 'Notification automatique DealAutoPro'
    },
    en: {
      subject: `[Admin] Certificate rejected — ${vehicleLabel} - DealAutoPro`,
      heading: 'Transfer certificate rejected',
      line1: `Seller <strong>${sellerName}</strong> rejected the certificate uploaded by buyer <strong>${buyerName}</strong>.`,
      line2: `Vehicle: ${vehicleLabel}${sessionName ? ` — ${sessionName}` : ''}.`,
      line3: 'The buyer has been asked to upload a compliant document. No action is required from you for now.',
      labels: { reason: 'Rejection reason', comment: 'Seller note' },
      text: `Certificate rejected. Seller: ${sellerName}. Buyer: ${buyerName}. Vehicle: ${vehicleLabel}. Reason: ${reasonLabel}.${comment ? ` Note: ${comment}.` : ''}`,
      footer: 'Automatic DealAutoPro notification'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line2}</p>
        ${rejectionBlock(reasonLabel, comment, copy.labels)}
        <p style="color: #5A5E66; font-size: 14px;">${copy.line3}</p>
      `
    })
  };
};

/**
 * Prévenir l'acheteur que la remise du véhicule peut avoir lieu : la déclaration d'achat
 * est disponible et son code de remise l'attend dans son espace.
 * Le code lui-même n'est volontairement pas transmis par e-mail.
 */
const saleHandoverReadyBuyerEmail = ({ user, brand, model, year, photoUrl, sessionName, saleId }) => {
  const lang = normalizeLanguage(user.language);
  const url = `${CLIENT_BASE_URL}${WON_SALE_PATH[lang]}/${saleId}`;
  const vehicleLabel = [brand, model].filter(Boolean).join(' ') || (lang === 'fr' ? 'Véhicule' : 'Vehicle');

  const copy = {
    fr: {
      subject: `Votre véhicule est prêt à être enlevé — ${vehicleLabel} - DealAutoPro`,
      heading: 'Vous pouvez récupérer votre véhicule',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Année ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `Le vendeur a validé le certificat de cession. La dernière étape est l'enlèvement de « ${vehicleLabel} ».`,
      line2: 'Votre <strong>déclaration d\'achat</strong> est disponible au téléchargement dans votre espace, accompagnée d\'un <strong>code de remise</strong>.',
      line3: 'Par sécurité, ce code n\'est pas transmis par e-mail : retrouvez-le dans votre espace et communiquez-le au vendeur uniquement au moment où vous récupérez le véhicule. Sa saisie clôture la vente.',
      cta: 'Voir mon code de remise',
      text: `Le vendeur a validé le certificat de cession. Votre déclaration d'achat et votre code de remise pour ${vehicleLabel} vous attendent dans votre espace. Ne communiquez le code au vendeur qu'au moment de l'enlèvement : ${url}`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: `Your vehicle is ready for collection — ${vehicleLabel} - DealAutoPro`,
      heading: 'You can collect your vehicle',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Year ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `The seller validated the transfer certificate. The last step is collecting "${vehicleLabel}".`,
      line2: 'Your <strong>purchase declaration</strong> is ready to download in your workspace, along with a <strong>handover code</strong>.',
      line3: 'For security, the code is not sent by email: find it in your workspace and give it to the seller only when you collect the vehicle. Entering it closes the sale.',
      cta: 'View my handover code',
      text: `The seller validated the transfer certificate. Your purchase declaration and handover code for ${vehicleLabel} are waiting in your workspace. Only give the code to the seller at collection: ${url}`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        ${vehicleCard(photoUrl, vehicleLabel, copy.subtitle)}
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        <p style="color: #13243C; font-size: 14px;">${copy.line2}</p>
        <p style="color: #B04A2C; font-size: 14px;">${copy.line3}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${url}" style="background-color: #D9704F; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

/**
 * Confirmer à l'une des deux parties que la vente est clôturée après l'enlèvement.
 * `role` choisit la formulation et le lien : 'acheteur' ou 'vendeur'.
 */
const saleClosedEmail = ({ user, role, brand, model, year, photoUrl, sessionName, saleId }) => {
  const lang = normalizeLanguage(user.language);
  const isBuyer = role === 'acheteur';
  const url = isBuyer
    ? `${CLIENT_BASE_URL}${WON_SALE_PATH[lang]}/${saleId}`
    : `${CLIENT_BASE_URL}${SELLER_SALES_PATH[lang]}/${saleId}`;
  const vehicleLabel = [brand, model].filter(Boolean).join(' ') || (lang === 'fr' ? 'Véhicule' : 'Vehicle');

  const copy = {
    fr: {
      subject: `Vente clôturée — ${vehicleLabel} - DealAutoPro`,
      heading: 'La vente est clôturée',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Année ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: isBuyer
        ? `L'enlèvement de « ${vehicleLabel} » a été confirmé par le vendeur. La transaction est terminée.`
        : `Vous avez confirmé la remise de « ${vehicleLabel} ». La transaction est terminée.`,
      line2: 'Vos documents restent accessibles depuis votre espace : certificat de cession et déclaration d\'achat.',
      cta: 'Voir mes documents',
      text: isBuyer
        ? `L'enlèvement de ${vehicleLabel} a été confirmé par le vendeur : la vente est clôturée. Vos documents restent accessibles : ${url}`
        : `Vous avez confirmé la remise de ${vehicleLabel} : la vente est clôturée. Vos documents restent accessibles : ${url}`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: `Sale completed — ${vehicleLabel} - DealAutoPro`,
      heading: 'The sale is complete',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Year ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: isBuyer
        ? `The seller confirmed the collection of "${vehicleLabel}". The transaction is complete.`
        : `You confirmed handing over "${vehicleLabel}". The transaction is complete.`,
      line2: 'Your documents remain available in your workspace: transfer certificate and purchase declaration.',
      cta: 'View my documents',
      text: isBuyer
        ? `The seller confirmed the collection of ${vehicleLabel}: the sale is complete. Your documents remain available: ${url}`
        : `You confirmed handing over ${vehicleLabel}: the sale is complete. Your documents remain available: ${url}`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        ${vehicleCard(photoUrl, vehicleLabel, copy.subtitle)}
        <p style="color: #2F6F4F; font-size: 15px; font-weight: bold;">${copy.line1}</p>
        <p style="color: #5A5E66; font-size: 14px;">${copy.line2}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${url}" style="background-color: #2F6F4F; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

/**
 * E-mail envoyé au candidat suivant de la liste d'attente lorsqu'il devient le nouveau
 * gagnant, suite au retrait du précédent (délai dépassé, règles non respectées...). La
 * procédure d'achat démarre aussitôt à l'étape 1 : il n'y a plus d'étape de confirmation
 * intermédiaire, le montant à payer et son délai sont annoncés directement.
 */
const saleReattributedWinnerEmail = ({ user, brand, model, year, photoUrl, sessionName, saleId, amount, deadlineHours }) => {
  const lang = normalizeLanguage(user.language);
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const url = `${CLIENT_BASE_URL}${WON_SALE_PATH[lang]}/${saleId}`;
  const vehicleLabel = [brand, model].filter(Boolean).join(' ') || (lang === 'fr' ? 'Véhicule' : 'Vehicle');
  const price = amount != null ? Number(amount).toLocaleString(locale) : null;
  const delay = formatDeadline(deadlineHours, lang);

  const copy = {
    fr: {
      subject: `Vous êtes le nouveau gagnant pour ${vehicleLabel} - DealAutoPro`,
      heading: 'Vous êtes le nouveau gagnant',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Année ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `Le précédent gagnant n'a pas respecté les règles de la plateforme et a perdu son attribution sur ${vehicleLabel}.`,
      line2: price ? `Votre offre de ${price} € est désormais retenue : vous êtes le nouveau gagnant.` : 'Votre offre est désormais retenue : vous êtes le nouveau gagnant.',
      line3: `Connectez-vous à la plateforme pour entamer votre procédure d'achat. Elle commence par le paiement de la commission plateforme : vous disposez de ${delay} pour finaliser cette première étape. Passé ce délai, le véhicule sera proposé au candidat suivant.`,
      cta: "Entamer ma procédure d'achat",
      text: `Le précédent gagnant n'a pas respecté les règles de la plateforme : vous êtes désormais le nouveau gagnant de ${vehicleLabel}${price ? ` avec votre offre de ${price} €` : ''}. `
        + `Connectez-vous pour entamer votre procédure d'achat : vous avez ${delay} pour payer la commission plateforme. ${url}`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: `You are the new winner for ${vehicleLabel} - DealAutoPro`,
      heading: 'You are the new winner',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Year ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `The previous winner did not comply with the platform rules and lost their award on ${vehicleLabel}.`,
      line2: price ? `Your bid of €${price} is now the winning bid: you are the new winner.` : 'Your bid is now the winning bid: you are the new winner.',
      line3: `Sign in to the platform to start your purchase procedure. It begins with paying the platform commission: you have ${delay} to complete this first step. After that, the vehicle will be offered to the next candidate.`,
      cta: 'Start my purchase',
      text: `The previous winner did not comply with the platform rules: you are now the new winner of ${vehicleLabel}${price ? ` with your bid of €${price}` : ''}. `
        + `Sign in to start your purchase procedure: you have ${delay} to pay the platform commission. ${url}`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        ${vehicleCard(photoUrl, vehicleLabel, copy.subtitle)}
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        <p style="color: #13243C; font-size: 16px; font-weight: bold;">${copy.line2}</p>
        <p style="color: #B04A2C; font-size: 14px; font-weight: bold;">${copy.line3}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${url}" style="background-color: #D9704F; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

const BIDS_PATH = { fr: '/fr/acheteur/tableau-de-bord/mes-offres', en: '/en/buyer/dashboard/my-bids' };

/**
 * Envoyé à la clôture d'une session aux enchérisseurs classés juste derrière le gagnant.
 * Leur offre n'est pas perdue : elle reste mobilisable si le gagnant sort de la procédure.
 * Le montant du gagnant n'est jamais divulgué — seul leur propre rang leur est communiqué.
 */
const saleWaitingListEmail = ({ user, brand, model, year, photoUrl, sessionName, rank, amount }) => {
  const lang = normalizeLanguage(user.language);
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const url = `${CLIENT_BASE_URL}${BIDS_PATH[lang]}`;
  const vehicleLabel = [brand, model].filter(Boolean).join(' ') || (lang === 'fr' ? 'Véhicule' : 'Vehicle');
  const price = amount != null ? Number(amount).toLocaleString(locale) : null;
  const position = lang === 'fr'
    ? (rank === 2 ? '2e' : `${rank}e`)
    : (rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`);

  const copy = {
    fr: {
      subject: `Vous êtes en liste d'attente pour ${vehicleLabel} - DealAutoPro`,
      heading: 'Vous êtes en liste d\'attente',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Année ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `À la clôture de ${sessionName}, votre offre sur ${vehicleLabel} figure parmi les trois meilleures : vous êtes ${position} offrant.`,
      line2: price ? `Montant de votre offre : ${price} €.` : null,
      line3: `Le véhicule a été attribué au meilleur offrant. Si celui-ci ne respecte pas les règles de la plateforme ou laisse expirer ses délais, le véhicule sera proposé au candidat suivant de la liste d'attente. Vous recevrez alors un e-mail vous invitant à accepter ou décliner, sans aucune pénalité.`,
      line4: 'Aucune action de votre part n\'est nécessaire pour le moment.',
      cta: 'Voir mes offres',
      text: `À la clôture de ${sessionName}, votre offre sur ${vehicleLabel}${price ? ` (${price} €)` : ''} figure parmi les trois meilleures : vous êtes ${position} offrant et vous êtes placé en liste d'attente. `
        + `Si le meilleur offrant ne respecte pas les règles de la plateforme, le véhicule vous sera proposé par e-mail. Aucune action n'est nécessaire pour le moment : ${url}`,
      footer: "L'équipe DealAutoPro"
    },
    en: {
      subject: `You are on the waiting list for ${vehicleLabel} - DealAutoPro`,
      heading: 'You are on the waiting list',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      subtitle: [year ? `Year ${year}` : null, sessionName].filter(Boolean).join(' · '),
      line1: `At the close of ${sessionName}, your bid on ${vehicleLabel} ranks among the top three: you are the ${position} highest bidder.`,
      line2: price ? `Your bid amount: €${price}.` : null,
      line3: `The vehicle has been awarded to the highest bidder. Should they fail to comply with the platform rules or let their deadlines expire, the vehicle will be offered to the next candidate on the waiting list. You will then receive an email inviting you to accept or decline, with no penalty.`,
      line4: 'No action is required from you at this stage.',
      cta: 'View my bids',
      text: `At the close of ${sessionName}, your bid on ${vehicleLabel}${price ? ` (€${price})` : ''} ranks among the top three: you are the ${position} highest bidder and have been placed on the waiting list. `
        + `If the highest bidder fails to comply with the platform rules, the vehicle will be offered to you by email. No action is required for now: ${url}`,
      footer: 'The DealAutoPro team'
    }
  }[lang];

  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({
      heading: copy.heading,
      footer: copy.footer,
      body: `
        <p style="color: #1A2230; font-size: 16px;">${copy.hello}</p>
        ${vehicleCard(photoUrl, vehicleLabel, copy.subtitle)}
        <p style="color: #5A5E66; font-size: 14px;">${copy.line1}</p>
        ${copy.line2 ? `<p style="color: #13243C; font-size: 16px; font-weight: bold;">${copy.line2}</p>` : ''}
        <p style="color: #5A5E66; font-size: 14px;">${copy.line3}</p>
        <p style="color: #5A5E66; font-size: 14px; font-style: italic;">${copy.line4}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${url}" style="background-color: #D9704F; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

module.exports = {
  SUPPORTED_LANGUAGES,
  normalizeLanguage,
  otpEmail,
  passwordResetEmail,
  approvalEmail,
  rejectionEmail,
  correctionEmail,
  dossierApprovalEmail,
  dossierRejectionEmail,
  dossierCorrectionEmail,
  saleWonEmail,
  saleStepReminderEmail,
  adminLatePaymentAlertEmail,
  saleWinnerRemovedEmail,
  saleReattributedWinnerEmail,
  saleWaitingListEmail,
  saleAwardedSellerEmail,
  saleUnsoldSellerEmail,
  saleCertificateReadyEmail,
  saleSignedCertificateSellerEmail,
  saleCertificateRejectedBuyerEmail,
  saleCertificateRejectedAdminEmail,
  saleHandoverReadyBuyerEmail,
  saleClosedEmail
};

const signatureReadyEmail = ({ user, brand, model, signatureUrl }) => {
  const isEn = user?.language === 'en';
  return {
    subject: isEn
      ? `Documents ready for signature - ${brand} ${model}`
      : `Documents prêts pour signature - ${brand} ${model}`,
    text: isEn
      ? `Hello ${user.firstName},\n\nThe sale documents for the ${brand} ${model} are ready.\nPlease click on the link below to sign them electronically:\n${signatureUrl}`
      : `Bonjour ${user.firstName},\n\nLes documents de vente pour le ${brand} ${model} sont prêts.\nVeuillez cliquer sur le lien ci-dessous pour les signer électroniquement :\n${signatureUrl}`,
    html: isEn
      ? `<p>Hello ${user.firstName},</p><p>The sale documents for the ${brand} ${model} are ready.</p><p><a href="${signatureUrl}">Click here to sign the documents</a></p>`
      : `<p>Bonjour ${user.firstName},</p><p>Les documents de vente pour le ${brand} ${model} sont prêts.</p><p><a href="${signatureUrl}">Cliquez ici pour signer les documents</a></p>`
  };
};
module.exports.signatureReadyEmail = signatureReadyEmail;

const sellerStampRequiredEmail = ({ user, brand, model, saleId }) => {
  const lang = normalizeLanguage(user.language);
  const vehicleLabel = [brand, model].filter(Boolean).join(' ') || (lang === 'fr' ? 'Véhicule' : 'Vehicle');
  const url = `${CLIENT_BASE_URL}${SELLER_SALES_PATH[lang]}/${saleId}`;
  const copy = lang === 'fr' ? {
    subject: `Tampon vendeur requis — ${vehicleLabel} - DealAutoPro`,
    heading: 'Ajoutez votre tampon aux documents signés',
    intro: `La signature électronique des documents de « ${vehicleLabel} » est terminée. Aucun tampon vendeur n’est enregistré sur votre compte.`,
    action: 'Téléchargez le dossier signé, apposez votre tampon sur le certificat de cession et la déclaration d’achat, puis déposez la version tamponnée dans votre espace.',
    cta: 'Déposer le dossier tamponné',
    text: `La signature électronique des documents de ${vehicleLabel} est terminée. Téléchargez le dossier signé, ajoutez votre tampon aux deux documents puis déposez-le ici : ${url}`,
  } : {
    subject: `Seller stamp required — ${vehicleLabel} - DealAutoPro`,
    heading: 'Add your stamp to the signed documents',
    intro: `Electronic signing for “${vehicleLabel}” is complete. No seller stamp is saved on your account.`,
    action: 'Download the signed file, stamp the transfer certificate and purchase declaration, then upload the stamped version.',
    cta: 'Upload the stamped file',
    text: `Electronic signing for ${vehicleLabel} is complete. Download the signed file, stamp both documents, then upload it here: ${url}`,
  };
  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({ heading: copy.heading, footer: lang === 'fr' ? "L'équipe DealAutoPro" : 'The DealAutoPro team', body: `
      <p style="color:#1A2230;font-size:16px;">${lang === 'fr' ? `Bonjour ${user.firstName} ${user.lastName},` : `Hello ${user.firstName} ${user.lastName},`}</p>
      <p style="color:#5A5E66;font-size:14px;">${copy.intro}</p>
      <p style="color:#13243C;font-size:14px;font-weight:bold;">${copy.action}</p>
      <div style="text-align:center;margin:30px 0;"><a href="${url}" style="background-color:#D9704F;color:white;padding:12px 25px;text-decoration:none;border-radius:5px;font-weight:bold;">${copy.cta}</a></div>` }),
  };
};

const buyerSellerStampValidationEmail = ({ user, brand, model, saleId }) => {
  const lang = normalizeLanguage(user.language);
  const vehicleLabel = [brand, model].filter(Boolean).join(' ') || (lang === 'fr' ? 'Véhicule' : 'Vehicle');
  const url = `${CLIENT_BASE_URL}${WON_SALE_PATH[lang]}/${saleId}`;
  const copy = lang === 'fr' ? {
    subject: `Documents vendeur à valider — ${vehicleLabel} - DealAutoPro`,
    heading: 'Le tampon vendeur attend votre validation',
    intro: `Les documents de « ${vehicleLabel} » ont été signés électroniquement et le tampon du vendeur a été appliqué.`,
    action: 'Consultez le dossier et validez les documents pour poursuivre la vente.',
    cta: 'Valider les documents',
    text: `Les documents signés de ${vehicleLabel} portent maintenant le tampon du vendeur. Consultez-les et validez-les ici : ${url}`,
  } : {
    subject: `Seller documents ready for validation — ${vehicleLabel} - DealAutoPro`,
    heading: 'The seller stamp is ready for your validation',
    intro: `The documents for “${vehicleLabel}” have been electronically signed and the seller stamp has been applied.`,
    action: 'Review and validate the documents to continue the sale.',
    cta: 'Validate the documents',
    text: `The signed documents for ${vehicleLabel} now include the seller stamp. Review and validate them here: ${url}`,
  };
  return {
    subject: copy.subject,
    text: copy.text,
    html: layout({ heading: copy.heading, footer: lang === 'fr' ? "L'équipe DealAutoPro" : 'The DealAutoPro team', body: `
      <p style="color:#1A2230;font-size:16px;">${lang === 'fr' ? `Bonjour ${user.firstName} ${user.lastName},` : `Hello ${user.firstName} ${user.lastName},`}</p>
      <p style="color:#5A5E66;font-size:14px;">${copy.intro}</p>
      <p style="color:#13243C;font-size:14px;font-weight:bold;">${copy.action}</p>
      <div style="text-align:center;margin:30px 0;"><a href="${url}" style="background-color:#2F6F4F;color:white;padding:12px 25px;text-decoration:none;border-radius:5px;font-weight:bold;">${copy.cta}</a></div>` }),
  };
};

module.exports.sellerStampRequiredEmail = sellerStampRequiredEmail;
module.exports.buyerSellerStampValidationEmail = buyerSellerStampValidationEmail;
