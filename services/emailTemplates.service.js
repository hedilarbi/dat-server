const SUPPORTED_LANGUAGES = ['fr', 'en'];

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
      subject: resend ? 'Nouveau code de vérification - DealsAutoPro' : 'Vérification de votre compte - DealsAutoPro',
      heading: resend ? 'Nouveau code de vérification' : 'Vérification de votre e-mail',
      hello: `Bonjour ${firstName} ${lastName},`,
      intro: resend
        ? 'Suite à votre demande, voici votre nouveau code de vérification :'
        : 'Merci de vous inscrire sur DealsAutoPro. Pour valider votre adresse e-mail, veuillez utiliser le code de vérification suivant :',
      confidentiality: 'Ce code est confidentiel et expirera dans 15 minutes.',
      text: resend
        ? `Votre nouveau code de vérification OTP est : ${otpCode}. Ce code expire dans 15 minutes.`
        : `Votre code de vérification OTP est : ${otpCode}. Ce code expire dans 15 minutes.`,
      footer: "L'équipe DealsAutoPro"
    },
    en: {
      subject: resend ? 'New verification code - DealsAutoPro' : 'Verify your account - DealsAutoPro',
      heading: resend ? 'New verification code' : 'Email verification',
      hello: `Hello ${firstName} ${lastName},`,
      intro: resend
        ? 'Here is your new verification code:'
        : 'Thank you for registering on DealsAutoPro. To validate your email address, use the following verification code:',
      confidentiality: 'This code is confidential and expires in 15 minutes.',
      text: resend
        ? `Your new OTP verification code is: ${otpCode}. This code expires in 15 minutes.`
        : `Your OTP verification code is: ${otpCode}. This code expires in 15 minutes.`,
      footer: 'The DealsAutoPro team'
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
      subject: 'Réinitialisation de votre mot de passe - DealsAutoPro',
      heading: 'Réinitialisation de mot de passe',
      hello: `Bonjour ${firstName} ${lastName},`,
      intro: 'Vous avez demandé la réinitialisation de votre mot de passe. Voici votre code de vérification :',
      confidentiality: 'Ce code est confidentiel et expirera dans 15 minutes. Si vous n\'êtes pas à l\'origine de cette demande, ignorez cet e-mail.',
      text: `Votre code de réinitialisation de mot de passe est : ${otpCode}. Ce code expire dans 15 minutes.`,
      footer: "L'équipe DealsAutoPro"
    },
    en: {
      subject: 'Reset your password - DealsAutoPro',
      heading: 'Password reset',
      hello: `Hello ${firstName} ${lastName},`,
      intro: 'You requested a password reset. Here is your verification code:',
      confidentiality: 'This code is confidential and expires in 15 minutes. If you did not request this, please ignore this email.',
      text: `Your password reset code is: ${otpCode}. This code expires in 15 minutes.`,
      footer: 'The DealsAutoPro team'
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
      subject: 'Votre compte a été validé ! - DealsAutoPro',
      heading: 'Votre compte est activé',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      line1: 'Nous avons le plaisir de vous informer que vos documents professionnels ont été vérifiés et votre compte a été validé.',
      line2: 'Vous pouvez dès à présent vous connecter sur votre espace pour commencer à utiliser nos services.',
      cta: 'Se connecter',
      text: 'Félicitations, votre compte professionnel a été validé par notre équipe. Vous pouvez maintenant accéder à la plateforme.',
      footer: "L'équipe DealsAutoPro"
    },
    en: {
      subject: 'Your account has been approved - DealsAutoPro',
      heading: 'Your account is active',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      line1: 'We are pleased to inform you that your business documents have been reviewed and your account has been approved.',
      line2: 'You can now sign in to your workspace and start using the platform.',
      cta: 'Sign in',
      text: 'Congratulations, your business account has been approved by our team. You can now access the platform.',
      footer: 'The DealsAutoPro team'
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
          <a href="https://dealsautopro.com/login" style="background-color: #13243C; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

const rejectionEmail = ({ user, reasonsText, reasonsPlain, comment }) => {
  const lang = normalizeLanguage(user.language);
  const copy = {
    fr: {
      subject: 'Action requise : Inscription refusée - DealsAutoPro',
      heading: "Dossier d'inscription incomplet ou non valide",
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      line1: "Après examen de vos documents professionnels, votre inscription ne peut pas être validée en l'état.",
      reasons: 'Motifs de refus :',
      comment: "Commentaire de l'administrateur :",
      line2: 'Pour corriger ces éléments, veuillez vous connecter sur votre espace et mettre à jour votre dossier.',
      cta: 'Accéder à mon espace',
      text: `Votre inscription a été refusée pour les raisons suivantes : ${reasonsPlain}. Commentaire : ${comment || ''}. Veuillez corriger votre dossier sur votre espace.`,
      footer: "L'équipe DealsAutoPro"
    },
    en: {
      subject: 'Action required: Registration rejected - DealsAutoPro',
      heading: 'Registration file incomplete or invalid',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      line1: 'After reviewing your business documents, your registration cannot be approved in its current state.',
      reasons: 'Rejection reasons:',
      comment: 'Administrator comment:',
      line2: 'To correct these items, please sign in to your workspace and update your file.',
      cta: 'Open my workspace',
      text: `Your registration was rejected for the following reasons: ${reasonsPlain}. Comment: ${comment || ''}. Please update your file in your workspace.`,
      footer: 'The DealsAutoPro team'
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
          <a href="https://dealsautopro.com/login" style="background-color: #13243C; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
        </div>
      `
    })
  };
};

const correctionEmail = ({ user, reasonsText, reasonsPlain, comment }) => {
  const lang = normalizeLanguage(user.language);
  const copy = {
    fr: {
      subject: 'Action requise : Correction de votre dossier - DealsAutoPro',
      heading: 'Correction demandée sur votre dossier',
      hello: `Bonjour ${user.firstName} ${user.lastName},`,
      line1: "Après examen de vos documents professionnels, quelques éléments doivent être corrigés avant validation de votre inscription.",
      reasons: 'Éléments à corriger :',
      comment: "Commentaire de l'administrateur :",
      line2: 'Merci de vous connecter sur votre espace et de mettre à jour votre dossier avec les éléments demandés.',
      cta: 'Accéder à mon espace',
      text: `Une correction est demandée sur votre dossier pour les raisons suivantes : ${reasonsPlain}. Commentaire : ${comment || ''}. Veuillez mettre à jour votre dossier sur votre espace.`,
      footer: "L'équipe DealsAutoPro"
    },
    en: {
      subject: 'Action required: Update your file - DealsAutoPro',
      heading: 'Correction requested on your file',
      hello: `Hello ${user.firstName} ${user.lastName},`,
      line1: 'After reviewing your business documents, a few items need to be corrected before your registration can be approved.',
      reasons: 'Items to correct:',
      comment: 'Administrator comment:',
      line2: 'Please sign in to your workspace and update your file with the requested items.',
      cta: 'Open my workspace',
      text: `A correction is requested on your file for the following reasons: ${reasonsPlain}. Comment: ${comment || ''}. Please update your file in your workspace.`,
      footer: 'The DealsAutoPro team'
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
          <a href="https://dealsautopro.com/login" style="background-color: #13243C; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">${copy.cta}</a>
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
  correctionEmail
};
