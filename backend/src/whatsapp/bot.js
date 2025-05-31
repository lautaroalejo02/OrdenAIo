console.log('Starting WhatsApp bot...');

import qrcode from 'qrcode';

(async () => {
  try {
    const pkg = await import('whatsapp-web.js');
    const { Client, LocalAuth } = pkg.default;

    // WhatsApp client configuration
    const client = new Client({
      authStrategy: new LocalAuth({
        dataPath: process.env.WHATSAPP_SESSION_PATH || './whatsapp-session',
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    // Display QR code in terminal for authentication
    client.on('qr', (qr) => {
      qrcode.toString(qr, { type: 'terminal', small: true }, (err, url) => {
        if (err) return console.error('Error generating QR code:', err);
        console.log('Scan this QR code with WhatsApp to log in:');
        console.log(url);
        // Print the raw QR string
        console.log('\nRaw QR string (for web QR generators):');
        console.log(qr);
        // Print a direct link to view the QR in the browser
        console.log('\nOpen this link in your browser to scan the QR with your phone:');
        console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`);
        // Save QR as PNG
        qrcode.toFile('qr.png', qr, { width: 400 }, (err) => {
          if (err) return console.error('Error saving QR PNG:', err);
          console.log('QR code saved as qr.png in the backend directory. You can open or share this PNG.');
        });
        // --- NEW: One-line logs for Railway/cloud logs ---
        console.log(`[QR-LINK] https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`);
        console.log(`[QR-STRING] ${qr}`);
      });
    });

    // Ready event
    client.on('ready', () => {
      console.log('WhatsApp bot is ready and connected.');
    });

    // Handle incoming messages
    client.on('message', async (msg) => {
      const { handleIncomingMessage } = await import('./messageHandler.js');
      handleIncomingMessage(msg, client);
    });

    // Authentication failure
    client.on('auth_failure', () => {
      console.error('Authentication failed. Please delete the session and scan the QR code again.');
    });

    // Disconnection event
    client.on('disconnected', (reason) => {
      console.warn('WhatsApp bot disconnected:', reason);
    });

    await client.initialize();
  } catch (err) {
    console.error('WhatsApp bot failed to start:', err);
  }
})(); 