import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = "postgresql://unitefix_db_user:F6V07JEPLdU1gsks0NqS0UMiXPT5WUim@dpg-d866tit7vvec7382re10-a.singapore-postgres.render.com/unitefix_db?sslmode=require";

async function resetDb() {
  const pool = new Pool({
    connectionString,
  });

  try {
    console.log("Connecting to Render database...");
    await pool.query('DROP SCHEMA public CASCADE;');
    console.log("Schema public dropped.");
    await pool.query('CREATE SCHEMA public;');
    console.log("Schema public created.");
    await pool.query('GRANT ALL ON SCHEMA public TO postgres;');
    await pool.query('GRANT ALL ON SCHEMA public TO public;');
    console.log("Permissions granted.");
  } catch (error) {
    console.error("Error resetting database:", error);
  } finally {
    await pool.end();
  }
}

resetDb();
