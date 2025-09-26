const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  // Initialize provider and wallet
  const provider = new ethers.JsonRpcProvider("https://rpc.sepolia-api.lisk.com");
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY env var missing");

  const wallet = new ethers.Wallet(privateKey, provider);

  // Contract addresses
  const wtkAddress = "0xd6e1afe5cA8D00A2EFC01B89997abE2De47fdfAf";
  const permitSwapAddress = "0xB0f05d25e41FbC2b52013099ED9616f1206Ae21B";

  // Token ABI
  const tokenABI = [
    "function name() view returns (string)",
    "function nonces(address) view returns (uint256)",
    "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address account) view returns (uint256)",
  ];

  const token = new ethers.Contract(wtkAddress, tokenABI, wallet);

  // Fetch token name
  let name;
  try {
    name = await token.name();
    console.log("Token Name:", name);
  } catch (error) {
    console.error("Failed to fetch token name:", error);
    throw new Error("Invalid contract or name() function");
  }

  // Fetch chainId and nonce
  const chainId = (await provider.getNetwork()).chainId;
  console.log("Chain ID:", chainId);
  const nonce = await token.nonces(wallet.address);
  console.log("Nonce:", ethers.toNumber(nonce));

  // Check token balance
  const balance = await token.balanceOf(wallet.address);
  console.log("Token Balance:", ethers.formatUnits(balance, 18), "WTK");

  // Check ETH balance
  const ethBalance = await provider.getBalance(wallet.address);
  console.log("ETH Balance:", ethers.formatEther(ethBalance));
  if (ethBalance < ethers.parseEther("0.004")) {
    throw new Error(
      "Insufficient ETH balance. Need at least 0.4 ETH. Fund wallet using a Sepolia Lisk faucet (e.g., https://thirdweb.com/lisk-sepolia-testnet or https://drpc.org/faucet/lisk)."
    );
  }

  // EIP-712 domain and types
  const domain = {
    name,
    version: "1", // Verify this matches the contract's version
    chainId,
    verifyingContract: wtkAddress,
  };

  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  // Permit parameters
  const amountIn = ethers.parseUnits("470", 18);
  if (balance < amountIn) throw new Error("Insufficient WTK balance for permit");

  const deadline = Math.floor(Date.now() / 1000) + 60 * 36000;

  const message = {
    owner: wallet.address,
    spender: permitSwapAddress,
    value: amountIn,
    nonce: ethers.toNumber(nonce),
    deadline,
  };

  // Log domain and message for debugging
  console.log("Domain:", domain);
  console.log("Message:", message);

  // Sign the typed data
  const signature = await wallet.signTypedData(domain, types, message);
  const sig = ethers.Signature.from(signature);

  // Verify signature
  const recoveredAddress = ethers.verifyTypedData(domain, types, message, signature);
  console.log("Recovered Address:", recoveredAddress, "Expected:", wallet.address);
  if (recoveredAddress.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error("Invalid signature");
  }

  console.log("PERMIT_V =", sig.v);
  console.log("PERMIT_R =", sig.r);
  console.log("PERMIT_S =", sig.s);

  // Estimate gas
  let gasLimit;
  try {
    gasLimit = await token.estimateGas.permit(
      wallet.address,
      permitSwapAddress,
      amountIn,
      deadline,
      sig.v,
      sig.r,
      sig.s
    );
    gasLimit = (gasLimit * 110n) / 100n; // Add 10% buffer
    console.log("Estimated Gas Limit:", gasLimit.toString());
  } catch (error) {
    console.error("Gas estimation failed:", error);
    console.warn("Using fallback gas limit of 100000");
    gasLimit = 100000; // Fallback gas limit
  }

  // Get current gas prices
  const feeData = await provider.getFeeData();
  console.log("Max Fee Per Gas:", ethers.formatUnits(feeData.maxFeePerGas, "gwei"), "Gwei");
  console.log("Max Priority Fee Per Gas:", ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei"), "Gwei");

  // Execute permit transaction
  try {
    console.log("Submitting permit transaction...");
    const tx = await token.permit(
      wallet.address,
      permitSwapAddress,
      amountIn,
      deadline,
      sig.v,
      sig.r,
      sig.s,
      { gasLimit, maxFeePerGas: feeData.maxFeePerGas }
    );
    const receipt = await tx.wait();
    console.log("Permit transaction successful:", tx.hash);

    // Verify allowance
    const allowance = await token.allowance(wallet.address, permitSwapAddress);
    console.log("Allowance:", ethers.formatUnits(allowance, 18), "WTK");
  } catch (error) {
    console.error("Permit transaction failed:", error);
    throw error;
  }
}

main().catch(console.error);