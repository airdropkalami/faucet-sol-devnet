# Solana Devnet Faucet Script

This script helps you request SOL from the Solana devnet faucet for multiple wallet addresses using proxies to avoid rate limiting.

## ⚠️ Disclaimer

**This bot is for educational purposes only. Use at your own risk. The maintainers are not responsible for any lost funds or account issues.**

## Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Prepare your `address.txt` file:**
   - Create a file named `address.txt` in the root directory
   - Add one Solana wallet address per line  
     Example:

     ```
     7v91N7iZ9mNicL8WfG6cgSCKyRXydQjLh6UYBWwm6y1M
     9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM
     ```

3. **Prepare your proxies:**
   - Create a file named `resilab.txt` in the `../../../Proxies/` directory
   - Add one proxy per line in the format: `host:port` or `username:password@host:port`  
     Example:

     ```
     http://1.2.3.4:8080
     http://user:pass@5.6.7.8:8080
     ```

## Usage

Run the script:

```bash
npm start
```

The script will:
1. Read wallet addresses from `address.txt`
2. Load proxies from the proxy file
3. Request 1 SOL for each wallet from the devnet faucet using random proxies
4. Wait for confirmation of each transaction
5. Add a 2-second delay between requests to avoid rate limiting

## Features

- Uses proxies to avoid rate limiting
- Automatic retry on connection failures
- Transaction confirmation with timeout handling
- Graceful error handling and reporting
- Progress tracking and summary statistics
- Graceful shutdown on interruption

## Notes

- The script uses the Solana devnet
- Each wallet can receive up to 1 SOL per request
- Make sure your wallet addresses are valid Solana addresses
- Ensure your proxies are working and properly formatted
- The script includes built-in delays and retries to handle rate limiting

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
