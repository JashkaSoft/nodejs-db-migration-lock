import { Sequelize } from 'sequelize';

export function createSequelize(): Sequelize {
  const dbType = process.env.DB_TYPE || 'postgres';
  const host = process.env.DB_HOST || 'localhost';
  const username = process.env.DB_USER || 'app';
  const password = process.env.DB_PASSWORD || 'app';
  const database = process.env.DB_NAME || 'app';

  if (dbType === 'mysql') {
    return new Sequelize(database, username, password, {
      host,
      port: parseInt(process.env.DB_PORT || '3306', 10),
      dialect: 'mysql',
      logging: false,
    });
  }

  return new Sequelize(database, username, password, {
    host,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    dialect: 'postgres',
    logging: false,
  });
}
