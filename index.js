const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const pino = require('pino');

const YTDLP = path.join(__dirname, 'yt-dlp');
const AUTH_DIR = path.join(__dirname, 'auth_session');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        const phoneNumber = (process.env.PHONE_NUMBER || '18453760157').replace(/[^0-9]/g, '');
        console.log(`\n⏳ Requesting 8-digit Pairing Code for ${phoneNumber}...`);
        
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`🔑 PAIRING CODE: ${formattedCode}`);
            } catch (err) {
                console.error('Failed to get pairing code:', err.message);
                setTimeout(startBot, 5000);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`Connection closed (reason code: ${statusCode}). Reconnecting...`);
            setTimeout(startBot, 5000);
        } else if (connection === 'open') {
            console.log('\n======================================================');
            console.log('✅ YOUR IPAD WHATSAPP BOT IS ONLINE & WORKING 24/7!');
            console.log('======================================================\n');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || !msg.message) return;

            const chatJid = msg.key.remoteJid || '';
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

            if (!text) return;

            console.log(`\n📩 [Received Message] text: "${text}"`);

            const isYT = text.includes('youtube.com/') || text.includes('youtu.be/');
            const isSpotify = text.includes('spotify.com/track/');

            if (!isYT && !isSpotify) return;

            if (isYT) {
                console.log(`⚡ Processing YouTube Link...`);
                await sock.sendMessage(chatJid, { text: '⏳ Downloading YouTube audio track...' }, { quoted: msg });
                downloadAndSendAudio(text, sock, chatJid, msg);
            } else if (isSpotify) {
                console.log(`⚡ Processing Spotify Link...`);
                await sock.sendMessage(chatJid, { text: '🎵 Fetching Spotify song info...' }, { quoted: msg });
                handleSpotifyLink(text, sock, chatJid, msg);
            }
        } catch (err) {
            console.error('Error handling message:', err);
        }
    });
}

function downloadAndSendAudio(searchQuery, sock, sender, originalMsg) {
    const filename = `track_${Date.now()}.m4a`;
    const outputFile = path.join(__dirname, filename);
    const cmd = `"${YTDLP}" -f "ba[ext=m4a]/140/ba/b" -o "${outputFile}" "${searchQuery}"`;

    exec(cmd, async (error, stdout, stderr) => {
        if (error) {
            console.error('Download error:', stderr || error.message);
            await sock.sendMessage(sender, { text: '❌ Failed to download audio file.' }, { quoted: originalMsg });
            return;
        }

        if (fs.existsSync(outputFile)) {
            console.log(`🚀 Sending ${outputFile} to WhatsApp!`);
            await sock.sendMessage(sender, {
                audio: fs.readFileSync(outputFile),
                mimetype: 'audio/mp4',
                ptt: false
            }, { quoted: originalMsg });
            fs.unlinkSync(outputFile);
            console.log('✅ Sent successfully!');
        } else {
            await sock.sendMessage(sender, { text: '❌ Output file not found after download.' }, { quoted: originalMsg });
        }
    });
}

async function handleSpotifyLink(url, sock, sender, originalMsg) {
    try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const titleMatch = response.data.match(/<title>(.*?)<\/title>/);
        let searchQuery = 'music track';

        if (titleMatch && titleMatch[1]) {
            searchQuery = titleMatch[1].replace(' | Spotify', '').replace(' - song by ', ' ');
        }

        console.log(`🔍 Spotify query: "${searchQuery}"`);
        await sock.sendMessage(sender, { text: `🔍 Found song: "${searchQuery}". Downloading...` }, { quoted: originalMsg });
        downloadAndSendAudio(`ytsearch1:${searchQuery}`, sock, sender, originalMsg);
    } catch (err) {
        console.error('Spotify error:', err.message);
        await sock.sendMessage(sender, { text: '❌ Could not retrieve song details from Spotify link.' }, { quoted: originalMsg });
    }
}

startBot();
