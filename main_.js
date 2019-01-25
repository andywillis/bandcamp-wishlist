const cheerio = require('cheerio');
const createThrottle = require('async-throttle');
const singleLog = require('single-line-log').stdout;
const each = require('async/each');
const eachOfLimit = require('async/eachOfLimit');
const fetch = require('node-fetch');
const request = require('request');
const path = require('path');

const IO = require('./lib/io');

const throttle = createThrottle(5);

const regex = {
  badCharsre: /[\\/:*?"<>|]/g,
  artistre: /artist: "(.*?)"/,
  albumre: /album_title: "(.*?)"/,
  tracksre: /trackinfo: (\[.*\])/i
};

function getMp3Links(html) {
  const $ = cheerio.load(html);
  const $links = $('a.fav-track-link');
  return $links.map((i, el) => $(el).attr('href')).get();
}

function getPromiseList(links) {
  return links.map((link, i) => throttle(async () => {
    singleLog(`Scanning: (${i + 1}/${links.length}) ${link}`);
    const res = await fetch(link);
    return res.text();
  }));
}

function regexCapture(txt, regex) {
  const out = txt.match(regex);
  if (out && out.length === 2) return out[1];
  return 'Missing';
}

async function writeM3u({ albumPath, folderName }, tracks) {
  const m3u = tracks.map(el => el.filename).join('\n');
  const stream = IO.createWriteStream(`${albumPath}/${folderName}.m3u`);
  stream.write(m3u);
  stream.end();
}

function compileTracks(arr, badCharsre) {
  return arr.map((track) => {
    if (track.file && track.file['mp3-128']) {
      const filename = `${track.title}.mp3`.replace(badCharsre, '');
      const url = track.file['mp3-128'];
      return { filename, url };
    }
    return undefined;
  }).filter(el => el !== undefined);
}

function iterateTracks(tracks, params) {
  const { albumPath, currentIndex, noOfAlbums, folderName } = params;
  each(tracks, ({ filename, url }, trackCallback) => {
    const stream = request(url);
    stream.on('error', err => console.log(err));
    const filePath = path.join(albumPath, filename);
    stream.pipe(IO.createWriteStream(filePath));
    stream.on('end', trackCallback);
  }, () => {
    console.log(`Completed (${currentIndex}/${noOfAlbums}) ${folderName}`);
  });
}

async function getWishlistLinks() {
  const html = await IO.readTextFile('wishlist.html');
  return getMp3Links(html);
}

async function init(urls) {

  const links = urls || await getWishlistLinks();

  const promises = getPromiseList(links);
  const albumList = await Promise.all(promises);
  const wishlistRoot = path.join(__dirname, 'wishlist');

  console.log('\n**');

  if (!await IO.pathExists(wishlistRoot)) {
    await IO.addFolder(wishlistRoot);
  }

  eachOfLimit(albumList, 5, async (txt, index) => {

    const artist = regexCapture(txt, regex.artistre);
    const albumTitle = regexCapture(txt, regex.albumre);
    const folderName = `${artist} - ${albumTitle}`.replace(regex.badCharsre, '');
    const trackJSON = regexCapture(txt, regex.tracksre);

    const albumPath = path.join(wishlistRoot, folderName);
    const noOfAlbums = albumList.length;
    const currentIndex = index + 1;
    const params = { currentIndex, albumPath, folderName, noOfAlbums };

    if (trackJSON === 'Missing') {

      console.log(`Missing (${currentIndex}/${albumList.length}) ${folderName}`);

    } else {

      const tracks = compileTracks(eval(trackJSON), regex.badCharsre);

      if (!await IO.pathExists(albumPath)) {
        await IO.addFolder(albumPath);
        writeM3u(params, tracks);
        iterateTracks(tracks, params);
      } else {
        console.log(`Skipping (${currentIndex}/${noOfAlbums}) ${folderName}`);
      }

    }

  });

}

module.exports = init;
