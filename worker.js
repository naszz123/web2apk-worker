#!/usr/bin/env node
/**
 * Web2APK GitHub Worker
 * Menjalankan build APK dari antrian master bot
 */

const axios = require('axios');
const { execSync, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

// Konfigurasi dari environment variables
const WORKER_ID = process.env.WORKER_ID || `worker-${os.hostname()}-${Date.now()}`;
const MASTER_URL = process.env.MASTER_URL;
const WORKER_TYPE = process.env.WORKER_TYPE || 'github';

// Validasi MASTER_URL
if (!MASTER_URL) {
    console.error('❌ MASTER_URL tidak diset!');
    console.error('   export MASTER_URL=https://domain-anda.com');
    process.exit(1);
}

console.log(`
╔════════════════════════════════════════╗
║     Web2APK GitHub Worker v1.0        ║
╚════════════════════════════════════════╝
`);

console.log(`📋 Worker Info:
   ID: ${WORKER_ID}
   Type: ${WORKER_TYPE}
   Master: ${MASTER_URL}
`);

let isBusy = false;
let currentJob = null;
let pollInterval = null;
let heartbeatInterval = null;

// ============================================
// REGISTER KE MASTER BOT
// ============================================
async function register() {
    try {
        console.log('📡 Registering to master...');
        await axios.post(`${MASTER_URL}/api/worker/register`, {
            workerId: WORKER_ID,
            type: WORKER_TYPE,
            capabilities: ['flutter', 'android'],
            apiUrl: MASTER_URL
        });
        console.log('✅ Successfully registered to master');
        return true;
    } catch (error) {
        console.error('❌ Registration failed:', error.message);
        console.log('🔄 Retrying in 10 seconds...');
        setTimeout(register, 10000);
        return false;
    }
}

// ============================================
// HEARTBEAT (Keep-alive)
// ============================================
async function sendHeartbeat() {
    try {
        await axios.post(`${MASTER_URL}/api/worker/heartbeat`, {
            workerId: WORKER_ID,
            status: isBusy ? 'busy' : 'idle'
        });
    } catch (error) {
        console.error('⚠️ Heartbeat failed:', error.message);
    }
}

// ============================================
// POLLING JOB DARI MASTER
// ============================================
async function pollJob() {
    if (isBusy) {
        return;
    }
    
    try {
        const response = await axios.get(`${MASTER_URL}/api/worker/poll/${WORKER_ID}`, {
            timeout: 5000
        });
        
        if (response.data.hasJob) {
            await executeJob(response.data.job);
        }
    } catch (error) {
        if (error.code !== 'ECONNREFUSED' && error.code !== 'ETIMEDOUT') {
            console.error('⚠️ Poll error:', error.message);
        }
    }
}

// ============================================
// EKSEKUSI BUILD JOB
// ============================================
async function executeJob(job) {
    isBusy = true;
    currentJob = job;
    
    console.log(`
┌─────────────────────────────────────────┐
│  🔨 EXECUTING BUILD JOB                 │
├─────────────────────────────────────────┤
│  Build ID: ${job.buildId}
│  Type: ${job.type}
│  User: ${job.userName}
│  Priority: ${job.userType}
└─────────────────────────────────────────┘
`);
    
    const tempDir = path.join('/tmp', `worker-${job.buildId}`);
    
    try {
        await fs.ensureDir(tempDir);
        
        let result;
        if (job.type === 'url') {
            result = await buildFromUrl(job, tempDir);
        } else if (job.type === 'zip') {
            result = await buildFromZip(job, tempDir);
        } else {
            throw new Error(`Unknown job type: ${job.type}`);
        }
        
        // Kirim hasil sukses ke master
        await sendResult(job.buildId, true, result);
        console.log(`✅ Build completed: ${job.buildId}`);
        
    } catch (error) {
        console.error(`❌ Build failed: ${error.message}`);
        await sendResult(job.buildId, false, { error: error.message });
        
    } finally {
        // Cleanup
        await fs.remove(tempDir).catch(() => {});
        isBusy = false;
        currentJob = null;
    }
}

// ============================================
// BUILD DARI URL (WebView APK)
// ============================================
async function buildFromUrl(job, tempDir) {
    const { buildData } = job;
    
    console.log(`📱 Building WebView APK`);
    console.log(`   App Name: ${buildData.appName}`);
    console.log(`   URL: ${buildData.url}`);
    console.log(`   Theme: ${buildData.themeColor || '#2196F3'}`);
    
    // Simulasi progress
    await reportProgress('📋 Menyiapkan project...');
    await sleep(2000);
    
    await reportProgress('🔨 Mengompilasi APK...');
    await sleep(5000);
    
    await reportProgress('📦 Packaging APK...');
    await sleep(2000);
    
    // Untuk production, Anda perlu implementasi build logic sebenarnya
    // Bisa copy dari apkBuilder.js atau panggil API internal
    
    return {
        downloadUrl: null, // Akan diisi setelah upload
        logs: [
            { timestamp: Date.now(), message: 'Build initiated' },
            { timestamp: Date.now(), message: 'Project prepared' },
            { timestamp: Date.now(), message: 'APK compiled successfully' }
        ]
    };
}

// ============================================
// BUILD DARI ZIP (Flutter/Android Project)
// ============================================
async function buildFromZip(job, tempDir) {
    const { buildData } = job;
    
    console.log(`📦 Building from ZIP`);
    console.log(`   Project Type: ${buildData.projectType}`);
    console.log(`   Build Type: ${buildData.buildType || 'release'}`);
    
    // Simulasi progress
    await reportProgress('📂 Extracting project files...');
    await sleep(2000);
    
    if (buildData.projectType === 'flutter') {
        await reportProgress('📦 Getting Flutter dependencies...');
        await sleep(5000);
        
        await reportProgress('🔨 Building Flutter APK...');
        await sleep(8000);
    } else {
        await reportProgress('🔨 Running Gradle build...');
        await sleep(10000);
    }
    
    await reportProgress('✅ Build complete!');
    await sleep(1000);
    
    return {
        downloadUrl: null,
        logs: [{ timestamp: Date.now(), message: 'Build simulation complete' }]
    };
}

// ============================================
// REPORT PROGRESS KE MASTER (via logs)
// ============================================
async function reportProgress(message) {
    console.log(`   📍 ${message}`);
    // Optional: kirim progress ke master via API
    if (currentJob) {
        try {
            await axios.post(`${MASTER_URL}/api/worker/progress/${currentJob.buildId}`, {
                message: message,
                timestamp: Date.now()
            }).catch(() => {});
        } catch (e) {}
    }
}

// ============================================
// KIRIM HASIL KE MASTER
// ============================================
async function sendResult(buildId, success, result) {
    try {
        await axios.post(`${MASTER_URL}/api/worker/result/${buildId}`, {
            success: success,
            downloadUrl: result.downloadUrl,
            error: result.error,
            logs: result.logs || []
        });
        console.log(`📤 Result sent to master`);
    } catch (error) {
        console.error(`❌ Failed to send result:`, error.message);
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// START WORKER
// ============================================
async function start() {
    await register();
    
    // Start heartbeat (every 15 seconds)
    heartbeatInterval = setInterval(sendHeartbeat, 15000);
    
    // Start polling (every 3 seconds)
    pollInterval = setInterval(pollJob, 3000);
    
    console.log(`
╔════════════════════════════════════════╗
║  🚀 WORKER IS RUNNING                  ║
║                                        ║
║  Waiting for jobs from master...       ║
║  Press Ctrl+C to stop                  ║
╚════════════════════════════════════════╝
`);
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down worker...');
    if (pollInterval) clearInterval(pollInterval);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down worker...');
    if (pollInterval) clearInterval(pollInterval);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    process.exit(0);
});

// Start
start().catch(console.error);
