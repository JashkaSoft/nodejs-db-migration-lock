import { DataTypes, QueryInterface } from 'sequelize';

export const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await context.createTable('users', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
  });
};

export const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await context.dropTable('users');
};
