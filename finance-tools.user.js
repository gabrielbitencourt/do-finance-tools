// ==UserScript==
// @name         DOFinanceTools
// @version      0.1
// @description  Better finance visualization for dugout-online
// @author       Gabriel Bitencourt
// @require      https://unpkg.com/dexie/dist/dexie.js
// @include      http*dugout-online.com/home/*
// @include      http*dugout-online.com/finances/*
// @homepage     https://github.com/gabrielbitencourt/do-finance-tools
// @downloadURL  https://github.com/gabrielbitencourt/do-finance-tools/raw/main/finance-tools.user.js
// @updateURL    https://github.com/gabrielbitencourt/do-finance-tools/raw/main/finance-tools.user.js
// ==/UserScript==

const seasons_starts = {
    41: '2022-01-04'
}

/**
 * @typedef {import('dexie').Dexie} Dexie
 * @typedef {import('dexie').Table} Table
 * @typedef {{ id: number, initial_balance: number }} Season
 * @typedef {{ season_id: number, date: number, current: number, total_players_salary: number, total_coaches_salary: number, current_players_salary: number, current_coaches_salary: number, building: number, tickets: number, transfers: number, sponsor: number, prizes: number, maintenance: number, others:number }} Finance
 */

const parser = new window.DOMParser();

/**
 * @type {Dexie}
 */
const db = new Dexie("DOFinanceDatabase");
db.version(2).stores({
    season: '&id',
    finance: '[season_id+date]'
});

/** @type {Table} */
const seasons = db.season;

/** @type {Table} */
const finances = db.finance;

/**
 * @type {Object.<number, (string | number)[]>}
 */
const indexes = {
    0: ['initial_balance', 1],
    2: ['total_players_salary', 3, 'current_players_salary', 4],
    5: ['total_coaches_salary', 6, 'current_coaches_salary', 7],
    8: ['building', 9],
    10: ['tickets', 11],
    12: ['transfers', 13],
    14: ['sponsor', 15],
    16: ['prizes', 17],
    18: ['maintenance', 19],
    20: ['others', 21],
    22: ['current', 23],
}

/**
 * 
 * @param {string} n
 * @returns {number}
 */
const parseNumbers = (n) => parseInt(n.split(' ')[0].replace(/\./g, ''));

/**
 * 
 * @param {Document} dom 
 */
const updateInfo = async (dom) =>
{
    const elements = [...dom.querySelectorAll('td')].map(el => el.innerText.trim()).filter(e => e);
    const save = elements.reduce((acc, _, index, arr) =>
    {
        const indexInfo = indexes[index];
        if (indexInfo)
        {
            acc[indexInfo[0]] = parseNumbers(arr[indexInfo[1]]);
            if (indexInfo.length > 2)
            {
                const splitted = arr[indexInfo[3]].split(' ');
                acc[indexInfo[2]] = parseNumbers(splitted[splitted.length - 2]);
            }

        }
        return acc;
    }, {});

    const currentSeason = parseInt(dom.querySelector('div.window_dialog_header').innerText.split(' ')[1]);
    await seasons.put({ initial_balance: save.initial_balance, id: currentSeason });
    await finances.put({
        season_id: currentSeason,
        date: new Date().toISOString().split('T')[0],
        ...save
    });
}

(async function() {
    console.log(window.location.pathname);
    switch (window.location.pathname) {
        case '/home/none/Free-online-football-manager-game':
            const response = await fetch("https://www.dugout-online.com/finances/none/", { method: 'GET' });
            const dom = parser.parseFromString(await response.text(), 'text/html');
            await updateInfo(dom);
            break;
    
        default:
            await updateInfo(document);
            break;
    }
})();
