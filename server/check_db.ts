
import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;

// Load .env manually
try {
    const envPath = path.resolve(process.cwd(), '.env');
    console.log(`Reading .env from: ${envPath}`);
    if (fs.existsSync(envPath)) {
        const envFile = fs.readFileSync(envPath, 'utf8');
        for (const line of envFile.split('\n')) {
            const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)$/);
            if (match) {
                const key = match[1];
                let val = match[2].trim();
                // Remove quotes if present
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                process.env[key] = val;
            }
        }
        console.log("Loaded keys from .env:", Object.keys(process.env).filter(k => envFile.includes(k)));
    } else {
        console.log("❌ .env file not found");
    }
} catch (e) {
    console.log("Could not read .env file", e);
}

async function check() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error("❌ DATABASE_URL is missing from .env");
        console.log("It must be exactly: DATABASE_URL=postgresql://...");
        return;
    }

    // Mask password for display
    const maskedUrl = url.replace(/:[^:@]*@/, ':****@');
    console.log(`Testing connection to: ${maskedUrl}`);

    const client = new Client({ connectionString: url });
    try {
        await client.connect();
        console.log("✅ Connection successfully established!");
        const res = await client.query('SELECT NOW()');
        console.log("🕒 Database time:", res.rows[0].now);
        await client.end();
    } catch (err: any) {
        console.error("❌ Connection failed:");
        console.error(`   Message: ${err.message}`);
        console.error(`   Code: ${err.code}`);
        // Port 5050 usage confirmed by user
    }
}


check();
