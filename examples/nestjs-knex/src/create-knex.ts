import knex, { Knex } from 'knex';

export function createKnex(): Knex {
  const dbType = process.env.DB_TYPE || 'postgres';
  const host = process.env.DB_HOST || 'localhost';
  const user = process.env.DB_USER || 'app';
  const password = process.env.DB_PASSWORD || 'app';
  const database = process.env.DB_NAME || 'app';

  if (dbType === 'mysql') {
    return knex({
      client: 'mysql2',
      connection: {
        host,
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user,
        password,
        database,
      },
    });
  }

  return knex({
    client: 'pg',
    connection: {
      host,
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user,
      password,
      database,
    },
  });
}
