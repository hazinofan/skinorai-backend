import { MigrationInterface, QueryRunner } from 'typeorm';

export class AiProviderArchitecture1784023200000 implements MigrationInterface {
  name = 'AiProviderArchitecture1784023200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE scan_records
        ADD COLUMN extracted_product_data text NULL,
        ADD COLUMN trusted_product_data text NULL,
        ADD COLUMN full_ingredient_list_visible tinyint NOT NULL DEFAULT 0,
        ADD COLUMN conversation_summary text NULL,
        ADD COLUMN analysis_provider varchar(30) NULL,
        ADD COLUMN analysis_model varchar(120) NULL
    `);

    await queryRunner.query(`
      CREATE TABLE product_extractions (
        id varchar(36) NOT NULL,
        user_id varchar(36) NOT NULL,
        extraction text NOT NULL,
        mime_type varchar(40) NOT NULL,
        image_bytes int NOT NULL,
        provider varchar(30) NOT NULL,
        model varchar(120) NOT NULL,
        input_tokens int NOT NULL DEFAULT 0,
        output_tokens int NOT NULL DEFAULT 0,
        latency_ms int NOT NULL DEFAULT 0,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        CONSTRAINT FK_product_extractions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE face_scan_records (
        id varchar(36) NOT NULL,
        user_id varchar(36) NOT NULL,
        skin_goal varchar(80) NULL,
        observations text NOT NULL,
        guidance text NOT NULL,
        conversation text NULL,
        conversation_summary text NULL,
        prompt_count int NOT NULL DEFAULT 0,
        consent_accepted tinyint NOT NULL DEFAULT 1,
        image_mime_types text NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        CONSTRAINT FK_face_scan_records_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE ai_usage_events (
        id varchar(36) NOT NULL,
        user_id varchar(36) NOT NULL,
        scan_id varchar(36) NULL,
        face_scan_id varchar(36) NULL,
        provider varchar(30) NOT NULL,
        model varchar(120) NOT NULL,
        request_type varchar(50) NOT NULL,
        input_tokens int NOT NULL DEFAULT 0,
        output_tokens int NOT NULL DEFAULT 0,
        estimated_cost_usd decimal(12,8) NOT NULL DEFAULT 0,
        latency_ms int NOT NULL DEFAULT 0,
        success tinyint NOT NULL DEFAULT 1,
        error_code varchar(80) NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        INDEX IDX_ai_usage_user_created (user_id, created_at),
        CONSTRAINT FK_ai_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE ai_usage_events');
    await queryRunner.query('DROP TABLE face_scan_records');
    await queryRunner.query('DROP TABLE product_extractions');
    await queryRunner.query(`
      ALTER TABLE scan_records
        DROP COLUMN analysis_model,
        DROP COLUMN analysis_provider,
        DROP COLUMN conversation_summary,
        DROP COLUMN full_ingredient_list_visible,
        DROP COLUMN trusted_product_data,
        DROP COLUMN extracted_product_data
    `);
  }
}
