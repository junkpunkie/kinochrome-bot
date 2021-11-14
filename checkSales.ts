import 'dotenv/config';
import Discord, { TextChannel } from 'discord.js';
import fetch from 'node-fetch';
import { ethers } from "ethers";
import nodeHtmlToImage from 'node-html-to-image';
import fs from "pn/fs"

const atob = (base64) => {
  return Buffer.from(base64, 'base64').toString('binary');
};

const OPENSEA_SHARED_STOREFRONT_ADDRESS = '0x495f947276749Ce646f68AC8c248420045cb7b5e';

const discordBot = new Discord.Client();
const  discordSetup = async (): Promise<TextChannel> => {
  return new Promise<TextChannel>((resolve, reject) => {
    ['DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_ID'].forEach((envVar) => {
      if (!process.env[envVar]) reject(`${envVar} not set`)
    })
  
    discordBot.login(process.env.DISCORD_BOT_TOKEN);
    discordBot.on('ready', async () => {
      const channel = await discordBot.channels.fetch(process.env.DISCORD_CHANNEL_ID!);
      resolve(channel as TextChannel);
    });
  })
}

const b64DecodeUnicode = (str) => {
  // Going backwards: from bytestream, to percent-encoding, to original string.
  return decodeURIComponent(
    atob(str)
      .split('')
      .map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      })
      .join('')
  )
}
const getSvg = (str) => {
  const svg = b64DecodeUnicode(
    str.split('data:image/svg+xml;base64,')[1]
  )
  return svg
}
const getMetadata = (str) => {
  // console.log(str)
  const metadata = JSON.parse(
    b64DecodeUnicode(
      str.split('data:application/json;base64,')[1]
    )
  )
  return metadata
}

const buildImage = (image: any) => (
  new Discord.MessageAttachment(image, 'kinochrome.jpeg') 
)

const buildMessage = (sale: any) => {
  const attributes = getMetadata(sale.asset.token_metadata).attributes.map((attr) => {
    return {
      name: attr.trait_type,
      value: attr.value
    }
  })
  // console.log(attributes)
  return (
    new Discord.MessageEmbed()
    .setColor('#0099ff')
    .setTitle(sale.asset.name + ' sold!')
    .setURL(sale.asset.permalink)
    .setAuthor('OpenSea Bot', 'https://files.readme.io/566c72b-opensea-logomark-full-colored.png', 'https://github.com/sbauch/opensea-discord-bot')
    .setThumbnail(sale.asset.collection.image_url)
    .addFields(
      { name: 'Name', value: sale.asset.name },
      { name: 'Amount', value: `${ethers.utils.formatEther(sale.total_price || '0')}${ethers.constants.EtherSymbol}`},
      { name: 'Buyer', value: sale?.winner_account?.address, },
      { name: 'Seller', value: sale?.seller?.address,  },
      // ...attributes
    )
    .setImage("attachment://kinochrome.jpeg")
    .setTimestamp(Date.parse(`${sale?.created_date}Z`))
    .setFooter('Sold on OpenSea', 'https://files.readme.io/566c72b-opensea-logomark-full-colored.png')
)}

async function main() {
  const channel = await discordSetup();
  const seconds = process.env.SECONDS ? parseInt(process.env.SECONDS) : 3_600;
  const hoursAgo = (Math.round(new Date().getTime() / 1000) - (seconds)); // in the last hour, run hourly?
  // const hoursAgo = (Math.round(new Date().getTime() - (24 * 60 * 60 * 1000)) - (seconds)); // last day
  
  const params = new URLSearchParams({
    offset: '0',
    event_type: 'successful',
    only_opensea: 'false',
    occurred_after: hoursAgo.toString(), 
    collection_slug: process.env.COLLECTION_SLUG!,
  })

  if (process.env.CONTRACT_ADDRESS !== OPENSEA_SHARED_STOREFRONT_ADDRESS) {
    params.append('asset_contract_address', process.env.CONTRACT_ADDRESS!)
  }

  const openSeaResponse = await fetch(
    "https://api.opensea.io/api/v1/events?" + params).then((resp) => resp.json());
    
  return await Promise.all(
    openSeaResponse?.asset_events?.reverse().map(async (sale: any) => {
      const image = await nodeHtmlToImage({
        html: `<html><body style="background: whitesmoke;"><div style="transform: translate(68.5%, 62.5%) scale(2);">${getSvg(getMetadata(sale.asset.token_metadata).image)}</div></body></html>`,
        quality: 1000,
        type: 'png',
        puppeteerArgs: {
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
      })
      const imagewrite = fs.writeFileSync('kinochrome.jpeg', image);      
      const message = buildMessage(sale);
      return await channel.send({ embed: message, files: [buildImage(image)] });
      // return channel.send(message)
    })
  );   
}

main()
  .then((res) =>{ 
    if (!res.length) console.log("No recent sales")
    process.exit(0)
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
