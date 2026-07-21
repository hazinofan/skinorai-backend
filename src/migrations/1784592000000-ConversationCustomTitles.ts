import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationCustomTitles1784592000000 implements MigrationInterface {
  name = 'ConversationCustomTitles1784592000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE scan_records ADD COLUMN custom_title varchar(160) NULL');
    await queryRunner.query('ALTER TABLE face_scan_records ADD COLUMN custom_title varchar(160) NULL');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE face_scan_records DROP COLUMN custom_title');
    await queryRunner.query('ALTER TABLE scan_records DROP COLUMN custom_title');
  }
}