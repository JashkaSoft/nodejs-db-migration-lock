import { DataSource } from 'typeorm';
import { User } from './user.entity';

const dbType = (process.env.DB_TYPE || 'postgres') as 'postgres' | 'mysql';

export function createDataSource(): DataSource {
  if (dbType === 'mysql') {
    return new DataSource({
      type: 'mysql',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      username: process.env.DB_USER || 'app',
      password: process.env.DB_PASSWORD || 'app',
      database: process.env.DB_NAME || 'app',
      entities: [User],
      migrations: [__dirname + '/migrations/*.{js,ts}'],
      synchronize: false,
    });
  }

  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'app',
    password: process.env.DB_PASSWORD || 'app',
    database: process.env.DB_NAME || 'app',
    entities: [User],
    migrations: [__dirname + '/migrations/*.{js,ts}'],
    synchronize: false,
  });
}
