const { DataTypes } = require('sequelize');
const { sequelize, EncryptedString, EncryptedText } = require('../config/database');

const Patient = sequelize.define('Patient', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  mrn: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      len: [1, 20]
    }
  },
  firstName: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [1, 50]
    }
  },
  lastName: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [1, 50]
    }
  },
  dateOfBirth: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    validate: {
      isDate: true,
      isPast: true
    }
  },
  gender: {
    type: DataTypes.ENUM('male', 'female', 'other', 'prefer_not_to_say'),
    allowNull: false
  },
  // Encrypted sensitive information
  ssn: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      is: /^\d{3}-?\d{2}-?\d{4}$/
    }
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      is: /^\+?[\d\s\-\(\)]+$/
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isEmail: true
    }
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  emergencyContact: {
    type: DataTypes.JSON,
    allowNull: true
  },
  insurance: {
    type: DataTypes.JSON,
    allowNull: true
  },
  // Medical information
  height: {
    type: DataTypes.DECIMAL(5, 2), // in cm
    allowNull: true
  },
  weight: {
    type: DataTypes.DECIMAL(5, 2), // in kg
    allowNull: true
  },
  bloodType: {
    type: DataTypes.ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'),
    allowNull: true
  },
  allergies: {
    type: DataTypes.JSON,
    allowNull: true
  },
  medications: {
    type: DataTypes.JSON,
    allowNull: true
  },
  medicalHistory: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  familyHistory: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  // HIPAA compliance
  consentSigned: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  consentDate: {
    type: DataTypes.DATE
  },
  dataSharingConsent: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  // Status
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'deceased', 'transferred'),
    defaultValue: 'active'
  },
  // Timestamps
  lastVisit: {
    type: DataTypes.DATE
  },
  nextAppointment: {
    type: DataTypes.DATE
  },
  // Notes and additional info
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  // Provider assignment
  primaryProviderId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  assignedProviders: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  tableName: 'patients',
  indexes: [
    {
      unique: true,
      fields: ['mrn']
    },
    {
      fields: ['lastName', 'firstName']
    },
    {
      fields: ['dateOfBirth']
    },
    {
      fields: ['primaryProviderId']
    },
    {
      fields: ['status']
    }
  ]
});

// Instance methods
Patient.prototype.getAge = function() {
  if (!this.dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(this.dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age;
};

Patient.prototype.getFullName = function() {
  return `${this.firstName} ${this.lastName}`;
};

Patient.prototype.toJSON = function() {
  const values = Object.assign({}, this.get());
  // Remove sensitive data from JSON output
  delete values.ssn;
  return values;
};

// Class methods
Patient.findByMRN = function(mrn) {
  return this.findOne({ where: { mrn } });
};

Patient.findByProvider = function(providerId) {
  return this.findAll({ 
    where: { 
      primaryProviderId: providerId,
      isActive: true 
    },
    order: [['lastName', 'ASC'], ['firstName', 'ASC']]
  });
};

module.exports = Patient;