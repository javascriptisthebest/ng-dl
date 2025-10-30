import * as cheerio from 'cheerio';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

const inputURL = process.argv[2],
      TooManyRequestsException = new Error("too many requests"),
      BadArgumentTypeException = new Error("illegal argument type")

function removeQueryParameters(url) {
    return url.split("?")[0]
}
async function downloadFile(url, filename) {
    var req = await fetch(url),
        blob = await req.blob(),
        buffer = Buffer.from(await blob.arrayBuffer())

    if(!filename) {
        fs.writeFileSync(removeQueryParameters(path.basename(url)), buffer)
        console.log("Saved file: " + removeQueryParameters(path.basename(url)) + " from URL: " + url)
    } else {
        fs.writeFileSync(filename, buffer)
        console.log("Saved file: " + filename + " from URL: " + url)
    }
}
async function getArtPage(url) {
    var req = await fetch(url + "/art")
    
    var html = await req.text()

    return html;
}
async function getPage(url) {
    var req = await fetch(url)

    if(req.status == 429) throw Errors["429"];
    var html = await req.text()

    var cheerioObj = cheerio.load(html)
    
    return cheerioObj;
}
async function retrieveArtImages(artLinks) {
    if (!typeof artLinks == 'object') {
        console.log("Illegal argument type: artLinks is a " + typeof artLinks + ", not an array" )
        throw BadArgumentTypeException;
    }
    for await (const link of artLinks) {

        console.log("Grabbing image at " + link)
        
        var artImagePage = await getPage(link),
            artImageContainer = artImagePage('div.art-item-container'),
            artImageLink = artImageContainer.children()[0].attribs['href']
        
        await downloadFile(artImageLink)
        console.log("Waiting 3 seconds to avoid 429 errors")

        await new Promise(r => setTimeout(r, 3000))

    }
    console.log("Finished grabbing " + artLinks.length + " images")
} 
async function main(url) {
    console.log("Retrieving art links...")

    var artPageHtml = await getArtPage(url),
        artPage = cheerio.load(artPageHtml),
        artHyperlinks = artPage('div.portalitem-art-icons-medium').find('div > a'),
        artTitles = artHyperlinks.children('h4')
    let artImageLinks = [];
    console.log("Expected to grab " + artHyperlinks.length + " images")
     
    for (let i = 0; i < artHyperlinks.length; i++) {
        const element = artHyperlinks[i]
        if(!element.attribs["href"]) continue;
        if(element.attribs["title"] == "Restricted Art") {
            console.log("Submission at " + element.attribs["href"] + " is rated Adult. Adult-rated submissions are not supported at this moment (requires login), skipping")
            continue;
        }
        artImageLinks.push(element.attribs["href"])
    }

    var imageLinks = await retrieveArtImages(artImageLinks)
    console.log(imageLinks)
}

await main(inputURL)