require('colors');
require('draftlog').into(console);

const cheerio = require('cheerio');
const each = require('async/each');
const request = require('request');
const path = require('path');
const createThrottle = require('async-throttle');
const fetch = require('node-fetch');

const IO = require('./lib/io');

const throttle = createThrottle(2);

let count = 0;
const limit = 3;
let interval;

const regex = {
  badCharsre: /[\\/:*?"<>|.]/g,
  artistre: /artist: "(.*?)"/,
  albumre: /album_title: "(.*?)"/,
  tracksre: /trackinfo: (\[.*\])/i
};

function regexCapture(txt, regex) {
  const out = txt.match(regex);
  if (out && out.length === 2) return out[1];
  return 'Missing';
}

async function createFolder(path) {
  if (!await IO.pathExists(path)) {
    await IO.addFolder(path);
  }
}

function pickInfo(txt) {
  const artist = regexCapture(txt, regex.artistre);
  const albumTitle = regexCapture(txt, regex.albumre);
  const folderName = `${artist} - ${albumTitle}`.replace(regex.badCharsre, '');
  const trackJSON = regexCapture(txt, regex.tracksre);
  return { artist, albumTitle, folderName, trackJSON };
}

function getAlbumPromises(links) {
  return Promise.all(links.map(link => throttle(() => fetch(link))));
}

function log(message) {
  console.log(message);
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

function getMp3Links(html) {
  const $ = cheerio.load(html);
  const $links = $('a.fav-track-link');
  return $links.map((i, el) => $(el).attr('href')).get();
}

async function writeM3u({ albumPath, folderName }, tracks) {
  const m3u = tracks.map(el => el.filename).join('\n');
  const stream = IO.createWriteStream(`${albumPath}/${folderName}.m3u`);
  stream.write(m3u);
  stream.end();
}

async function getWishlistLinks() {
  const html = await IO.readTextFile('wishlist.html');
  return getMp3Links(html);
}

function downloadTracks(tracks, params, status) {
  const { albumPath, folderName } = params;
  count++;
  each(tracks, ({ filename, url }, trackCallback) => {
    const stream = request(url);
    stream.on('error', err => console.log(err));
    const filePath = path.join(albumPath, filename);
    stream.pipe(IO.createWriteStream(filePath));
    stream.on('end', trackCallback);
  }, () => {
    status(['* '.grey, `${folderName}`, ' ✓'.green].join(''));
    count--;
  });
}

async function init(urls) {

  const links = urls || await getWishlistLinks();
  const promises = await getAlbumPromises(links);
  const noOfAlbums = promises.length;
  const wishlistRoot = path.join(__dirname, 'wishlist');

  createFolder(wishlistRoot);

  log('');
  log('Processing...'.rainbow);
  log('*************'.grey);
  log('*'.grey);

  async function iterate() {

    if (promises.length && count < limit) {

      const promise = promises.shift();
      const txt = await promise.text();
      const albumInfo = pickInfo(txt);

      const { folderName, trackJSON } = albumInfo;
      const albumPath = path.join(wishlistRoot, folderName);
      const params = { albumPath, folderName, noOfAlbums };
      const status = console.draft();

      status(['* '.grey, `${folderName}`].join(''));

      if (trackJSON === 'Missing') {
        status(['* '.grey, `${folderName}`, ' ⨯'.red].join(''));
      } else {
 
        const tracks = compileTracks(JSON.parse(trackJSON), regex.badCharsre);
 
        if (!await IO.pathExists(albumPath)) {
          await IO.addFolder(albumPath);
          writeM3u(params, tracks);
          downloadTracks(tracks, params, status);
        } else {
          status(['* '.grey, `${folderName}`, ' O'.grey].join(''));
        }

      }
    }

    if (!promises.length) {
      log('*'.grey);
      log('*************'.grey);
      log('Processing complete!'.rainbow);
      clearInterval(interval);
    }

  }

  interval = setInterval(async () => {
    await iterate();
  }, 2000);

}

module.exports = init;
