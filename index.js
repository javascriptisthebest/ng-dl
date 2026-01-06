import * as cheerio from 'cheerio';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { Builder, Browser, By, Key, until } from 'selenium-webdriver';


const program = new Command(),
    movieHeaders = new Headers(),
    config = JSON.parse(fs.readFileSync("config.json", "utf8")),
    TooManyRequestsException = new Error("too many requests"),
    BadArgumentTypeException = new Error("illegal argument type"),
    NotANGLinkException = new Error("not a newgrounds link"),
    NotImplementedException = new Error("behavior not implemented"),
    BlankURLException = new Error("input URL is blank"),
    InvalidSubPageException = new Error("invalid sub page URL"),
    IllegalConfigurationException = new Error("the configuration file does not contain the required fields for selenium to work")
//console.log(config)
movieHeaders.append("X-Requested-With", "XMLHttpRequest")
program
    .option('-v, --verbose', 'verbose output')
    .option('-a, --adult', 'download adult submissions')
    .option('-s, --selenium', 'use selenium (for downloading adult art/game/etc submissions)')
    .argument('url', 'the URL to download')


program.parse(process.argv);

if (program.opts().verbose)
    console.log("Command-line arguments:")
    console.log(program.opts())

var inputURL = program.args[0]


if (program.opts().selenium) if (!config || !config.username || !config.password) { throw IllegalConfigurationException }
if (!inputURL) throw BlankURLException;
// Remove any leading slashes to avoid errors while checking the type of the URL
if (inputURL.endsWith("/")) inputURL = inputURL.substring(0, inputURL.length - 1)

function log(msg, type, creator) {
    switch (type) {
        case "info":
            console.log(creator + ": " + chalk.blue("INFO: ") + msg)
            break;
        case "warn":
            console.log(creator + ": " + chalk.yellow("WARNING: ") + msg)
            break;
        case "error":
            console.log(creator + ": " + chalk.red("ERROR: ") + msg)
            break;
        default:
            console.log(creator + ": " + chalk.blue("INFO: ") + msg)
            break;
    }
}
function removeQueryParameters(url) {
    return url.split("?")[0]
}
async function downloadFile(url, filename) {
    var req = await fetch(url),
        contentlength = req.headers.get('Content-Length'),
        blob = await req.blob(),
        buffer = Buffer.from(await blob.arrayBuffer())
    if (program.opts().verbose) log("Expected to write " + contentlength + " bytes", "info", "[download]");

    if (!filename) {
        fs.writeFileSync(removeQueryParameters(path.basename(url)), buffer)
        log("Saved file: " + removeQueryParameters(path.basename(url)) + " from URL: " + url, "info", "[download]")
    } else {
        fs.writeFileSync(filename, buffer)
        log("Saved file: " + filename + " from URL: " + url, "info", "[download]")
    }
}
async function getTypeOfPage(url) {
    var URLparts = url.split("/")
    if (!URLparts[2].endsWith(".newgrounds.com")) {
        if (!URLparts[2].includes("newgrounds.com")) {
            if (program.opts().verbose) {
                log("Type of URL: notng", "info", "[ng-dl]")
            }
            return "notng";
        }
        if (program.opts().verbose) {
            log("Type of URL: notprofile", "info", "[ng-dl]")
        }
        return "notprofile";
    } else {
        if (URLparts[2] == "www.newgrounds.com") {
            if (program.opts().verbose) {
                log("Type of URL: notprofile", "info", "[ng-dl]")
            }
            return "notprofile";
        }
        if (program.opts().verbose) {
            log("Type of URL: profile", "info", "[ng-dl]")
        }
        return "profile";
    }
}
async function getTypeOfSubpage(url) {
    var URLparts = url.split("/")
    if (URLparts[3] == "art") {
        if (URLparts[4] == "view" && URLparts[5] && URLparts[6]) {
            if (program.opts().verbose) log("Type of subpage URL: art", "info", "[ng-dl]")
            return "art";
        } else { throw InvalidSubPageException; }

    } else if (URLparts[3] == "portal") {
        if (URLparts[4] && URLparts[5]) {
            if (program.opts().verbose) log("Type of subpage URL: portal", "info", "[ng-dl]")
            return "portal";
        }
    }
    throw InvalidSubPageException;
}
async function getArtPage(url) {
    var req = await fetch(url + "/art")

    var html = await req.text()

    return html;
}
async function getMoviesPage(url) {
    // DO NOT REMOVE ?SORT=SCORE FROM URL, THE IMPLEMENTATION REQUIRES IT!
    var req = await fetch(url + "/movies?sort=score")

    var html = await req.text()

    return html;
}
async function getPage(url) {
    var req = await fetch(url)

    if (req.status == 429) throw TooManyRequestsException;
    var html = await req.text()

    var cheerioObj = cheerio.load(html)

    return cheerioObj;
}
async function retrieveArtImages(artLinks) {
    if (!typeof artLinks == 'object') {
        log("Illegal argument type: artLinks is a " + typeof artLinks + ", not an array", "error", "[ng-dl]")
        throw BadArgumentTypeException;
    }
    for await (const link of artLinks) {

        log("Grabbing image at " + link, "info", "[ng-dl]")

        var artImagePage = await getPage(link),
            artImageContainer = artImagePage('div.art-item-container'),
            artImageLink = artImageContainer.children()[0].attribs['href']

        await downloadFile(artImageLink)
        log("Waiting 3 seconds to avoid 429 errors", "info", "[ng-dl]")

        await new Promise(r => setTimeout(r, 3000))
    }
    log("Finished grabbing " + artLinks.length + " images", "info", "[ng-dl]")
}
async function retrieveArtLinks(url) {
    var artPageHtml = await getArtPage(url),
        artPage = cheerio.load(artPageHtml),
        artHyperlinks = artPage('div.portalitem-art-icons-medium').find('div > a'),
        artImageLinks = {}
    artImageLinks.nonadult = [];
    artImageLinks.adult = [];

    log("Expected to grab " + artHyperlinks.length + " images", "info", "[ng-dl]")

    for (let i = 0; i < artHyperlinks.length; i++) {
        const element = artHyperlinks[i]
        if (!element.attribs["href"]) continue;
        if (element.attribs["title"] == "Restricted Art") {
            if(program.opts().selenium) {
                artImageLinks.adult.push(element.attribs["href"])
                continue;
            }
            log("The art submission at " + element.attribs["href"] + " is rated Adult. Art submissions rated as Adult are not supported at this moment (requires login), skipping", "warn", "[ng-dl]")
            continue;
        }
        artImageLinks.nonadult.push(element.attribs["href"])
    }

    return artImageLinks;
}
async function retrieveMovieLinks(url) {
    var moviePageHtml = await getMoviesPage(url),
        moviePage = cheerio.load(moviePageHtml),
        movieHyperlinks = moviePage('div.portalsubmission-cards').find('div > a'),
        movieLinks = [],
        numberOfAdultMovies = 0

    for (let i = 0; i < movieHyperlinks.length; i++) {
        if (movieHyperlinks[i].attribs["title"] == "Restricted Content") {
            if (program.opts().adult) {
                movieLinks.push(movieHyperlinks[i].attribs["href"])
            } else {
                log("The movie submission at " + movieHyperlinks[i].attribs["href"] + " is rated Adult, and the --adult option is not specified. Skipping.", "warn", "[ng-dl]")
                numberOfAdultMovies++;
            }
        }
    }
    log("Expected to grab " + (movieHyperlinks.length - numberOfAdultMovies) + " movies", "info", "[ng-dl]")

    return movieLinks;
}
async function retrieveMovieFiles(movieLinks) {
    for await (const link of movieLinks) {
        log("Grabbing movie at " + link, "info", "[ng-dl]")
        var movieFileUrl = "https://www.newgrounds.com/portal/video/" + link.split("/")[5]
        var movie = await fetch(movieFileUrl, {
            headers: movieHeaders
        })

        var movieResponse = await movie.json();
        // This one-liner is disgusting!
        var movieLink = movieResponse.sources[Object.keys(movieResponse.sources)[0]][0].src
        await downloadFile(movieLink)

        log("Waiting 3 seconds to avoid 429 errors", "info", "[ng-dl]")

        await new Promise(r => setTimeout(r, 3000))
    }
}
async function retrieveAdultSubmissions(subLinks) {
    /*
        This function WILL be universal in the future, (maybe) along with the rest of the program.
        It can only grab art for now.
    */
    let driver = await new Builder().forBrowser(Browser.FIREFOX).build()
    log("Setting up browser...", "info", "[ng-dl]")
    await driver.get('https://www.newgrounds.com/passport')
    await driver.wait(until.titleIs('Newgrounds Passport'))
    await driver.findElement(By.css("input[name='username']")).sendKeys(config.username)
    await driver.findElement(By.css("input[name='password']")).sendKeys(config.password)
    await driver.findElement(By.css("button[name='login']")).click()
    await driver.wait(until.titleIs('Your Feed'))
    for await (const link of subLinks) {
        log("Grabbing adult submission at " + link, "info", "[ng-dl]")

        await driver.get(link)
        log("Waiting 3 seconds for page to load", "info", "[ng-dl]")
        await driver.manage().setTimeouts({implicit: 3000})
        let artLink;
        try {
            artLink = await driver.findElement(By.className("art-item-container")).findElement(By.css("a")).getAttribute("href")
        } catch(err) {
            log("The current method failed because this art submission has multiple parts. Trying method 2. (which can't grab any alts)", "info", "ng-dl")
            artLink = await driver.findElement(By.css("a[data-action='view-image']")).getAttribute("href")
        }
        await downloadFile(artLink)

        log("Waiting 5 seconds to avoid 429 errors", "info", "[ng-dl]")

        await new Promise(r => setTimeout(r, 5000))
    }
}
async function main(url) {
    var typeOfPage = await getTypeOfPage(url)
    if (typeOfPage == "notng") throw NotANGLinkException;
    if (typeOfPage == "notprofile") {
        var typeOfSubpage = await getTypeOfSubpage(url)
        console.log(typeOfSubpage)
        if (typeOfSubpage == "portal") throw NotImplementedException;
    }


    log("Retrieving art links...", "info", "[ng-dl]")

    var artImageLinks = await retrieveArtLinks(url)

    await retrieveArtImages(artImageLinks.nonadult)
    if(program.opts().selenium && program.opts().adult && config.username && config.password) {
        await retrieveAdultSubmissions(artImageLinks.adult)
    } else {
        
    }
    await retrieveMovieFiles(await retrieveMovieLinks(url))
}

await main(inputURL)