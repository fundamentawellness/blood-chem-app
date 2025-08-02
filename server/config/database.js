const { Sequelize } = require('sequelize');
const crypto = require('crypto');

// Database configuration
const sequelize = new Sequelize(
  process.env.DB_NAME || 'hipaa_healthcare_db',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || 'password',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 20,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    dialectOptions: {
      ssl: process.env.NODE_ENV === 'production' ? {
        require: true,
        rejectUnauthorized: false
      } : false
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true
    }
  }
);

// Encryption utilities for HIPAA compliance
const encryptionKey = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const encryptionIV = process.env.ENCRYPTION_IV || crypto.randomBytes(16).toString('hex');

const encrypt = (text) => {
  if (!text) return null;
  const cipher = crypto.createCipher(process.env.ENCRYPTION_ALGORITHM || 'aes-256-gcm', encryptionKey);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

const decrypt = (encryptedText) => {
  if (!encryptedText) return null;
  try {
    const decipher = crypto.createDecipher(process.env.ENCRYPTION_ALGORITHM || 'aes-256-gcm', encryptionKey);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return null;
  }
};

// Custom data types for encrypted fields
const EncryptedString = {
  type: Sequelize.TEXT,
  get() {
    const rawValue = this.getDataValue('value');
    return rawValue ? decrypt(rawValue) : null;
  },
  set(value) {
    this.setDataValue('value', value ? encrypt(value) : null);
  }
};

const EncryptedText = {
  type: Sequelize.TEXT,
  get() {
    const rawValue = this.getDataValue('value');
    return rawValue ? decrypt(rawValue) : null;
  },
  set(value) {
    this.setDataValue('value', value ? encrypt(value) : null);
  }
};

// Database connection test
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection has been established successfully.');
    return true;
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
    return false;
  }
};

// Database initialization
const initializeDatabase = async () => {
  try {
    await sequelize.authenticate();
    
    if (process.env.NODE_ENV === 'development') {
      // Sync all models in development
      await sequelize.sync({ alter: true });
      console.log('✅ Database models synchronized in development mode.');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    return false;
  }
};

module.exports = {
  sequelize,
  encrypt,
  decrypt,
  EncryptedString,
  EncryptedText,
  testConnection,
  initializeDatabase
};