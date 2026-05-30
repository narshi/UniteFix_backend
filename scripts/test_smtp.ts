import nodemailer from 'nodemailer';

const user = 'admin@unitefix.com';
const pass = 'Ng9KRAHUs6pB';

async function testSend(host: string, port: number, secure: boolean) {
  console.log(`\nAttempting to SEND mail via ${host}:${port} (secure: ${secure})...`);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    tls: {
      rejectUnauthorized: false
    }
  });

  try {
    const info = await transporter.sendMail({
      from: `"UniteFix Test" <${user}>`,
      to: 'admin@unitefix.com',
      subject: `SMTP Test via ${host}`,
      text: `This is a test email sent from the server using host ${host}:${port}`
    });
    console.log(`SUCCESS: Message sent! Message ID: ${info.messageId}`);
    return true;
  } catch (error: any) {
    console.error(`FAILED to send: ${host}:${port} - ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log("=== Testing smtp.zoho.in ===");
  await testSend('smtp.zoho.in', 465, true);

  console.log("\n=== Testing smtppro.zoho.in ===");
  await testSend('smtppro.zoho.in', 465, true);
  
  process.exit(0);
}

runTests();
