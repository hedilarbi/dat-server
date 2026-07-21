const User = require('../models/user.model');

const seedAdmin = async () => {
  try {
    const adminEmail = 'admin@gmail.com';
    const adminExists = await User.findOne({ email: adminEmail });

    if (!adminExists) {
      console.log("Aucun administrateur trouvé. Création de l'administrateur par défaut...");
      
      const defaultAdmin = new User({
        email: adminEmail,
        password: '12312312', // Sera haché automatiquement par le middleware pre-save
        firstName: 'System',
        lastName: 'Admin',
        companyName: 'DealAutoPro',
        activityType: 'Administration',
        phone: '0000000000',
        role: 'admin',
        address: {
          street: '1 Rue de la Plateforme',
          city: 'Paris',
          country: 'France',
          postalCode: '75001'
        },
        status: 'valide',
        emailVerified: true,
        language: 'fr'
      });

      await defaultAdmin.save();
      console.log("Administrateur par défaut créé avec succès ! (admin@gmail.com / 12312312)");
    } else {
      console.log("L'administrateur par défaut admin@gmail.com existe déjà.");
    }
  } catch (error) {
    console.error(`Erreur lors de la création de l'administrateur par défaut : ${error.message}`);
  }
};

module.exports = seedAdmin;
