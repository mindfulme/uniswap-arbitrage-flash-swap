require('dotenv').config();
const Web3 = require('web3');
const BigNumber = require('bignumber.js');
const {performance} = require('perf_hooks');

const { mainnet: addresses } = require('./addresses');
const FlashswapApi = require('./abis/index').flashswapv2;
const BlockSubscriber = require('./src/block_subscriber');
const Prices = require('./src/prices');

let FLASHSWAP_CONTRACT = process.env.CONTRACT;

const TransactionSender = require('./src/transaction_send');

const web3 = new Web3(
    new Web3.providers.WebsocketProvider(process.env.WSS_BLOCKS, {
        reconnect: {
            auto: true,
            delay: 5000, // ms
            maxAttempts: 15,
            onTimeout: false
        }
    })
);

const { address: admin } = web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY);

const BNB_MAINNET = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const BUSD_MAINNET = '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56';
const USDT_MAINNET = '0x55d398326f99059fF775485246999027B3197955';
const BAKE_MAINNET = '0xE02dF9e3e622DeBdD69fb838bB799E3F168902c5';
const KALM_MAINNET = '0x4BA0057f784858a48fe351445C672FF2a3d43515';
const DOGGY_MAINNET = '0x74926B3d118a63F6958922d3DC05eB9C6E6E00c6';
const BARK_MAINNET = '0xb1528a7BE5A96B77de5337988Ba69029cA6E2c7A';
const TOKAU_MAINNET = '0xC409eC8a33f31437Ed753C82EEd3c5F16d6D7e22';
const XMS_1001 = '0x062faE7193A4395a9D95921Ed3F9aebbCd11EC70';

const prices = {};
const flashswap = new web3.eth.Contract(FlashswapApi, FLASHSWAP_CONTRACT);

const pairs = [
    {
        name: 'BUSD/BNB pancake>bakery',
        tokenBorrow: BUSD_MAINNET,
        amountTokenPay: 10,
        tokenPay: BNB_MAINNET,
        sourceRouter: addresses.pancake.router,
        targetRouter: addresses.bakery.router,
        sourceFactory: addresses.pancake.factory,
    },
    // {
    //     name: 'BAKE/BNB panacke>bakery',
    //     tokenBorrow: BAKE_MAINNET,
    //     amountTokenPay: 5,
    //     tokenPay: BNB_MAINNET,
    //     sourceFactory: addresses.pancake.factory,
    //     sourceRouter: addresses.pancake.router,
    //     targetRouter: addresses.bakery.router,
    // },
    // {
    //     name: 'DOGGY/BNB bakery>panacke',
    //     tokenBorrow: DOGGY_MAINNET,
    //     amountTokenPay: 1,
    //     tokenPay: BNB_MAINNET,
    //     sourceRouter: addresses.bakery.router,
    //     targetRouter: addresses.pancake.router,
    //     sourceFactory: addresses.bakery.factory,
    // },
    // {
    //     name: 'BAKE/BUSD panacke>baby',
    //     tokenBorrow: BAKE_MAINNET,
    //     amountTokenPay: 200,
    //     tokenPay: BUSD_MAINNET,
    //     sourceFactory: addresses.pancake.factory,
    //     sourceRouter: addresses.pancake.router,
    //     targetRouter: addresses.baby.router,
    // },
    // {
    //     name: 'BARK/BNB bakery>pancake',
    //     tokenBorrow: BARK_MAINNET,
    //     amountTokenPay: 1,
    //     tokenPay: BNB_MAINNET,
    //     sourceFactory: addresses.bakery.factory,
    //     sourceRouter: addresses.bakery.router,
    //     targetRouter: addresses.pancake.router,
    // },
    // {
    //     name: 'TOKAU/USDT bakery->pancake',
    //     tokenBorrow: TOKAU_MAINNET,
    //     amountTokenPay: 100,
    //     tokenPay: USDT_MAINNET,
    //     sourceRouter: addresses.bakery.router,
    //     targetRouter: addresses.pancake.router,
    //     sourceFactory: addresses.bakery.factory,
    // },
    // {
    //     name: 'BUSD/BNB pancake>baby',
    //     tokenBorrow: BUSD_MAINNET,
    //     amountTokenPay: 1,
    //     tokenPay: BNB_MAINNET,
    //     sourceRouter: addresses.pancake.router,
    //     targetRouter: addresses.baby.router,
    //     sourceFactory: addresses.pancake.factory,
    // }
]

const init = async () => {
    console.log('starting: ', JSON.stringify(pairs.map(p => p.name)));

    const transactionSender = TransactionSender.factory(process.env.WSS_BLOCKS.split(','));

    let nonce = await web3.eth.getTransactionCount(admin);
    let gasPrice = await web3.eth.getGasPrice()

    setInterval(async () => {
        nonce = await web3.eth.getTransactionCount(admin);
    }, 1000 * 19);

    setInterval(async () => {
        gasPrice = await web3.eth.getGasPrice()
    }, 1000 * 60 * 3);

    let owner;
    try {
        owner = await flashswap.methods.owner().call()
    } catch (e) {
        console.log(``, 'owner error', e.message);
        owner = admin;
    }


    console.log(`started: wallet ${admin} - gasPrice ${gasPrice} - contract owner: ${owner}`);

    let handler = async () => {
        const myPrices = await Prices.getPrices();
        if (Object.keys(myPrices).length > 0) {
            for (const [key, value] of Object.entries(myPrices)) {
                prices[key.toLowerCase()] = value;
            }
        }
    };

    await handler();
    setInterval(handler, 1000 * 60 * 5);

    const onBlock = async (block, web3, provider) => {
        const start = performance.now();

        const calls = [];

        const flashswap = new web3.eth.Contract(FlashswapApi, FLASHSWAP_CONTRACT);

        pairs.forEach((pair) => {
            calls.push(async () => {
                const check = await flashswap.methods.check(pair.tokenBorrow, new BigNumber(pair.amountTokenPay * 1e18), pair.tokenPay, pair.sourceRouter, pair.targetRouter).call();

                const profit = check[0];

                let s = pair.tokenPay.toLowerCase();
                const price = prices[s];
                if (!price) {
                    console.log('invalid price', pair.tokenPay);
                    return;
                }

                const profitUsd = profit / 1e18 * price;
                const percentage = (100 * (profit / 1e18)) / pair.amountTokenPay;
                console.log(`[${block.number}] [${new Date().toLocaleString()}]: [${provider}] [${pair.name}] Arbitrage checked! Expected profit: ${(profit / 1e18).toFixed(3)} $${profitUsd.toFixed(2)} - ${percentage.toFixed(2)}%`);

                if (profit > 0) {
                    console.log(`[${block.number}] [${new Date().toLocaleString()}]: [${provider}] [${pair.name}] Arbitrage opportunity found! Expected profit: ${(profit / 1e18).toFixed(3)} $${profitUsd.toFixed(2)} - ${percentage.toFixed(2)}%`);

                    const tx = flashswap.methods.start(
                        block.number + 2,
                        pair.tokenBorrow,
                        new BigNumber(pair.amountTokenPay * 1e18),
                        pair.tokenPay,
                        pair.sourceRouter,
                        pair.targetRouter,
                        pair.sourceFactory,
                    );

                    let estimateGas
                    try {
                        estimateGas = await tx.estimateGas({from: admin});
                        console.log(`[${block.number}] [${new Date().toLocaleString()}]: [${pair.name}] estimateGas: ${estimateGas}`);
                    } catch (e) {
                        console.log(`[${block.number}] [${new Date().toLocaleString()}]: [${pair.name}]`, 'gasCost error', e.message);
                        return;
                    }

                    const myGasPrice = new BigNumber(gasPrice).plus(gasPrice * 0.2212).toString();
                    const txCostBNB = Web3.utils.toBN(estimateGas) * Web3.utils.toBN(myGasPrice);

                    let gasCostUsd = (txCostBNB / 1e18) * prices[BNB_MAINNET.toLowerCase()];
                    const profitMinusFeeInUsd = profitUsd - gasCostUsd;

                    if (profitMinusFeeInUsd < 0.6) {
                        console.log(`[${block.number}] [${new Date().toLocaleString()}] [${provider}]: [${pair.name}] stopped: `, JSON.stringify({
                            profit: "$" + profitMinusFeeInUsd.toFixed(2),
                            profitWithoutGasCost: "$" + profitUsd.toFixed(2),
                            gasCost: "$" + gasCostUsd.toFixed(2),
                            duration: `${(performance.now() - start).toFixed(2)} ms`,
                            provider: provider,
                            myGasPrice: myGasPrice.toString(),
                            txCostBNB: txCostBNB / 1e18,
                            estimateGas: estimateGas,
                        }));
                    }

                    if (profitMinusFeeInUsd > 0.6) {
                        console.log(`[${block.number}] [${new Date().toLocaleString()}] [${provider}]: [${pair.name}] and go: `, JSON.stringify({
                            profit: "$" + profitMinusFeeInUsd.toFixed(2),
                            profitWithoutGasCost: "$" + profitUsd.toFixed(2),
                            gasCost: "$" + gasCostUsd.toFixed(2),
                            duration: `${(performance.now() - start).toFixed(2)} ms`,
                            provider: provider,
                        }));

                        const data = tx.encodeABI();
                        const txData = {
                            from: admin,
                            to: flashswap.options.address,
                            data: data,
                            gas: estimateGas,
                            gasPrice: new BigNumber(myGasPrice),
                            nonce: nonce
                        };

                        let number = performance.now() - start;
                        if (number > 1500) {
                            console.error('out of time window: ', number);
                            return;
                        }

                        console.log(`[${block.number}] [${new Date().toLocaleString()}] [${provider}]: sending transactions...`, JSON.stringify(txData))

                        try {
                            await transactionSender.sendTransaction(txData);
                        } catch (e) {
                            console.error('transaction error', e);
                        }
                    }
                }
            })
        })

        try {
            await Promise.all(calls.map(fn => fn()));
        } catch (e) {
            console.log('error', e)
        }

        let number = performance.now() - start;
        if (number > 1500) {
            console.error('warning to slow', number);
        }

        if (block.number % 40 === 0) {
            console.log(`[${block.number}] [${new Date().toLocaleString()}]: alive (${provider}) - took ${number.toFixed(2)} ms`);
        }
    };

    BlockSubscriber.subscribe(process.env.WSS_BLOCKS.split(','), onBlock);
}

init();
