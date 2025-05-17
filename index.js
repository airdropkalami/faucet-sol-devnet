const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL, clusterApiUrl } = require('@solana/web3.js');
const fs = require('fs');
const fetch = require('node-fetch');
const readlineSync = require('readline-sync');
const bs58 = require('bs58');
const { HttpsProxyAgent } = require('https-proxy-agent');
const chalk = require('chalk');

// Global variables for tracking state
let isProcessing = false;
let failedWallets = [];
let successCount = 0;
let failCount = 0;
let currentWallet = null;
let isExiting = false;

async function readWallets() {
    try {
        const wallets = [];
        const fileContent = await fs.promises.readFile('address.txt', 'utf8');
        const lines = fileContent.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
            try {
                // Add the wallet address directly
                wallets.push({
                    'publicKey': line.trim()
                });
            } catch (err) {
                console.error(`Error processing wallet: ${err.message}`);
                continue;
            }
        }
        return wallets;
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log("No wallets found in address.txt");
            return [];
        }
        throw err;
    }
}

// Function to validate and format proxy URL
function formatProxyUrl(proxyUrl) {
    try {
        // If the URL doesn't start with http:// or https://, add http://
        if (!proxyUrl.startsWith('http://') && !proxyUrl.startsWith('https://')) {
            proxyUrl = 'http://' + proxyUrl;
        }
        
        const url = new URL(proxyUrl);
        // Ensure we have a valid host and port
        if (!url.hostname || !url.port) {
            throw new Error('Invalid proxy URL: missing host or port');
        }
        return url;
    } catch (error) {
        console.error(chalk.red('Error formatting proxy URL:'), error.message);
        throw error;
    }
}

// Function to create a proxy agent with better SSL/TLS handling
function createProxyAgent(proxyUrl) {
    try {
        const url = formatProxyUrl(proxyUrl);
        console.log(chalk.gray(`Creating proxy agent for ${url.hostname}:${url.port}`));
        
        return new HttpsProxyAgent({
            protocol: url.protocol,
            host: url.hostname,
            port: url.port,
            auth: url.username ? `${url.username}:${url.password}` : undefined,
            rejectUnauthorized: false,
            secureProtocol: 'TLSv1_2_method',
            ciphers: 'HIGH:!aNULL:!MD5:!RC4',
            minVersion: 'TLSv1.2',
            maxVersion: 'TLSv1.3',
            keepAlive: true,
            timeout: 30000,
            keepAliveMsecs: 1000,
            maxSockets: 1,
            socketTimeout: 30000,
            connectTimeout: 30000
        });
    } catch (error) {
        console.error(chalk.red(`Error creating proxy agent for ${proxyUrl}:`), error.message);
        throw error;
    }
}

// Function to read proxies from file
async function loadProxies() {
    try {
        const proxyData = await fs.promises.readFile('./proxies.txt', 'utf8');
        const proxies = proxyData.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#')); // Skip empty lines and comments
        
        // Validate each proxy URL
        const validProxies = [];
        for (const proxy of proxies) {
            try {
                formatProxyUrl(proxy);
                validProxies.push(proxy);
            } catch (error) {
                console.error(chalk.yellow(`Skipping invalid proxy: ${proxy}`), error.message);
            }
        }
        
        if (validProxies.length === 0) {
            throw new Error('No valid proxies found in the file');
        }
        
        console.log(chalk.gray(`Loaded ${validProxies.length} valid proxies`));
        return validProxies;
    } catch (error) {
        console.error(chalk.red('Error loading proxies:'), error.message);
        return [];
    }
}

// Function to get a random proxy
function getRandomProxy(proxies) {
    return proxies[Math.floor(Math.random() * proxies.length)];
}

// Modified requestAirdrop function with better timeout handling
async function requestAirdrop(walletAddress, proxyUrl) {
    try {
        console.log(chalk.gray('Starting airdrop request...'));
        const publicKey = new PublicKey(walletAddress);
        const proxyAgent = createProxyAgent(proxyUrl);
        
        // Request airdrop using direct POST
        const airdropBody = {
            jsonrpc: "2.0",
            id: 1,
            method: "requestAirdrop",
            params: [
                publicKey.toString(),
                LAMPORTS_PER_SOL
            ]
        };

        console.log(chalk.gray('Sending airdrop request...'));
        let airdropRes;
        try {
            airdropRes = await Promise.race([
                fetch("https://api.devnet.solana.com", {
                    method: "POST",
                    body: JSON.stringify(airdropBody),
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    },
                    agent: proxyAgent,
                    timeout: 30000,
                    size: 0,
                    compress: true,
                    follow: 0,
                    redirect: 'manual'
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Airdrop request timeout')), 30000)
                )
            ]);
        } catch (fetchError) {
            console.error(chalk.red('Fetch error during airdrop:'), fetchError);
            if (fetchError.message === 'Airdrop request timeout') {
                throw new Error('TIMEOUT');
            }
            // Check for SSL/EPROTO errors
            if (fetchError.code === 'EPROTO' || fetchError.message?.includes('SSL') || fetchError.message?.includes('wrong version number')) {
                throw new Error('SSL_ERROR');
            }
            throw new Error(`Airdrop fetch failed: ${fetchError.message}`);
        }

        let responseText;
        try {
            responseText = await airdropRes.text();
        } catch (textError) {
            console.error(chalk.red('Error reading response text:'), textError);
            throw new Error(`Failed to read response: ${textError.message}`);
        }

        if (!airdropRes.ok) {
            console.error(chalk.red('Airdrop response not OK:'), responseText);
            
            if (airdropRes.status === 429) {
                console.log(chalk.yellow('Rate limit hit, waiting longer before retry...'));
                await new Promise(resolve => setTimeout(resolve, 5000));
                throw new Error('RATE_LIMIT');
            }
            
            throw new Error(`Airdrop request failed: ${airdropRes.statusText} - ${responseText}`);
        }

        let airdropData;
        try {
            airdropData = JSON.parse(responseText);
        } catch (jsonError) {
            console.error(chalk.red('JSON parse error:'), jsonError);
            throw new Error(`Failed to parse airdrop response: ${jsonError.message}`);
        }

        if (airdropData.error) {
            console.error(chalk.red('Airdrop RPC error:'), airdropData.error);
            throw new Error(`Airdrop error: ${JSON.stringify(airdropData.error)}`);
        }

        if (!airdropData.result) {
            console.error(chalk.red('Invalid airdrop response:'), airdropData);
            throw new Error('Invalid airdrop response: missing result');
        }

        const signature = airdropData.result;

        // Confirm transaction
        let confirmed = false;
        let retries = 0;
        const maxConfirmRetries = 10;
        let lastConfirmError = null;

        console.log(chalk.gray('Starting transaction confirmation...'));
        while (!confirmed && retries < maxConfirmRetries) {
            try {
                const confirmBody = {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "getSignatureStatuses",
                    params: [[signature], { searchTransactionHistory: true }]
                };

                let confirmRes;
                try {
                    confirmRes = await Promise.race([
                        fetch("https://api.devnet.solana.com", {
                            method: "POST",
                            body: JSON.stringify(confirmBody),
                            headers: {
                                'Content-Type': 'application/json',
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                            },
                            agent: proxyAgent,
                            timeout: 30000,
                            size: 0,
                            compress: true,
                            follow: 0,
                            redirect: 'manual'
                        }),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Confirmation request timeout')), 30000)
                        )
                    ]);
                } catch (fetchError) {
                    console.error(chalk.red('Fetch error during confirmation:'), fetchError);
                    lastConfirmError = fetchError;
                    
                    if (fetchError.code === 'ECONNRESET') {
                        console.log(chalk.yellow('Connection reset during confirmation, retrying...'));
                        retries++;
                        await new Promise(resolve => setTimeout(resolve, 2000 * (retries + 1)));
                        continue;
                    }
                    
                    throw new Error(`Confirmation fetch failed: ${fetchError.message}`);
                }

                if (!confirmRes.ok) {
                    const errorText = await confirmRes.text();
                    console.error(chalk.red('Confirmation response not OK:'), errorText);
                    throw new Error(`Confirmation request failed: ${confirmRes.statusText} - ${errorText}`);
                }

                let confirmData;
                try {
                    confirmData = await confirmRes.json();
                } catch (jsonError) {
                    console.error(chalk.red('JSON parse error during confirmation:'), jsonError);
                    throw new Error(`Failed to parse confirmation response: ${jsonError.message}`);
                }

                if (confirmData.error) {
                    console.error(chalk.red('Confirmation RPC error:'), confirmData.error);
                    throw new Error(`Confirmation error: ${JSON.stringify(confirmData.error)}`);
                }

                if (!confirmData.result?.value) {
                    console.error(chalk.red('Invalid confirmation response:'), confirmData);
                    throw new Error('Invalid confirmation response: missing result value');
                }

                const status = confirmData.result.value[0];
                if (status === null) {
                    retries++;
                    console.log(chalk.gray(`Transaction pending... (${retries}/${maxConfirmRetries})`));
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                }

                if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
                    confirmed = true;
                    console.log(chalk.green('Transaction confirmed'));
                } else if (status?.err) {
                    throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
                } else {
                    retries++;
                    console.log(chalk.gray(`Waiting for confirmation... (${retries}/${maxConfirmRetries})`));
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (error) {
                console.error(chalk.yellow('Confirmation attempt failed:'), error.message);
                lastConfirmError = error;
                retries++;
                
                if (retries >= maxConfirmRetries) {
                    throw new Error(`Transaction confirmation failed after ${maxConfirmRetries} attempts. Last error: ${lastConfirmError?.message || error.message}`);
                }
                
                const delay = 2000 * (retries + 1);
                console.log(chalk.gray(`Waiting ${delay}ms before next confirmation attempt...`));
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        if (!confirmed) {
            throw new Error(`Transaction confirmation timeout. Last error: ${lastConfirmError?.message || 'Unknown error'}`);
        }

        return { success: true };
    } catch (error) {
        console.error(chalk.red('Error in requestAirdrop:'), error);
        // Don't return success for any errors
        throw error;
    }
}

async function processWallets(wallets) {
    if (isProcessing) {
        console.log(chalk.yellow('Already processing wallets. Please wait...'));
        return;
    }

    isProcessing = true;
    const totalWallets = wallets.length;
    console.log(chalk.cyan(`\nStarting to process ${totalWallets} wallets...\n`));

    try {
        const proxies = await loadProxies();
        if (proxies.length === 0) {
            throw new Error('No valid proxies available');
        }

        for (let i = 0; i < wallets.length; i++) {
            const wallet = wallets[i];
            if (isExiting) {
                console.log(chalk.yellow('\nProcess interrupted by user.'));
                break;
            }

            currentWallet = wallet;
            const proxyUrl = getRandomProxy(proxies);
            
            try {
                console.log(chalk.gray(`[${i + 1}/${totalWallets}] Processing ${wallet.publicKey}...`));
                const result = await requestAirdrop(wallet.publicKey, proxyUrl);
                if (result && result.success) {
                    successCount++;
                    console.log(chalk.green(`[${i + 1}/${totalWallets}] ${wallet.publicKey}: Success`));
                } else {
                    failCount++;
                    failedWallets.push(wallet.publicKey);
                    console.error(chalk.red(`[${i + 1}/${totalWallets}] ${wallet.publicKey}: Failed - Unknown error`));
                }
            } catch (error) {
                failCount++;
                failedWallets.push(wallet.publicKey);
                console.error(chalk.red(`[${i + 1}/${totalWallets}] ${wallet.publicKey}: Failed - ${error.message}`));
            }

            // Add a small delay between requests
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    } catch (error) {
        console.error(chalk.red('Error in processWallets:'), error);
    } finally {
        isProcessing = false;
        currentWallet = null;
        console.log(chalk.cyan('\n=== Processing Complete ==='));
        console.log(chalk.white(`Total Wallets: ${totalWallets}`));
        console.log(chalk.green(`Successful: ${successCount}`));
        console.log(chalk.red(`Failed: ${failCount}`));
        if (failedWallets.length > 0) {
            console.log(chalk.yellow('\nFailed Wallets:'));
            failedWallets.forEach((wallet, index) => {
                console.log(chalk.yellow(`${index + 1}. ${wallet}`));
            });
        }
    }
}

async function main() {
    try {
        const wallets = await readWallets();
        if (wallets.length === 0) {
            console.log(chalk.red('No wallets found to process.'));
            return;
        }

        console.log(chalk.cyan(`Found ${wallets.length} wallets to process.`));
        await processWallets(wallets);
    } catch (error) {
        console.error(chalk.red('Error in main:'), error);
    }
}

// Handle process termination
process.on('SIGINT', () => {
    if (isProcessing) {
        console.log(chalk.yellow('\nGracefully shutting down...'));
        isExiting = true;
    } else {
        process.exit(0);
    }
});

main().catch(console.error); 