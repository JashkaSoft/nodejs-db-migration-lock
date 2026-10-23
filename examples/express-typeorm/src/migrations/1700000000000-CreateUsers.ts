import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1700000000000 implements MigrationInterface {
  name = 'CreateUsers1700000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const mysql = queryRunner.connection.options.type === 'mysql';
    if (mysql) {
      await queryRunner.query(
        'CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE)',
      );
      return;
    }
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS users');
  }
}
