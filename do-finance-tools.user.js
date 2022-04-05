// ==UserScript==
// @name         DOFinanceTools
// @version      0.1
// @description  Better finance visualization for dugout-online
// @author       Gabriel Bitencourt
// @require      https://unpkg.com/dexie/dist/dexie.js
// @include      *dugout-online.com/home/none/Free-online-football-manager-game
// @include      *dugout-online.com/finances/*
// ==/UserScript==

const seasons_starts = {
    41: '2022-01-04'
}

/**
 * @typedef {import('dexie').Dexie} Dexie
 * @typedef {import('dexie').Table} Table
 */

const parser = new window.DOMParser();

/**
 * @type {Dexie}
 */
const db = new Dexie("DOFinanceDatabase");
db.version(1).stores({
    season: '&id,intial_balance',
    finance: 'season_id,date,current,total_players_salary,total_coaches_salary,current_players_salary,current_coaches_salary,building,tickets,transfers,sponsor,prizes,maintenance,others'
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
const parseNumbers = (n) => parseInt(n.split(' ')[0].replace(/\./, ''));

const updateInfo = async (dom) =>
{
    
    const elements = [...dom.querySelectorAll('td')].map(el => el.innerText.trim()).filter(e => e);
    const save = elements.reduce((acc, _, index, arr) =>
    {
        const indexInfo = indexes[index];
        if (indexInfo)
        {
            acc[indexInfo[0]] = parseNumbers(arr[1]);
            if (indexInfo.length > 2)
            {
                const splitted = arr[3].split(' ');
                acc[indexInfo[2]] = parseNumbers(splitted[splitted.length - 2]);
            }

        }
        return acc;
    }, {});

    const currentSeason = parseInt(dom.querySelector('div.window_dialog_header').innerText.split(' ')[1]);
    await seasons.put({ initial_balance: save.initial_balance, id: currentSeason });
    /**
     * @type {{ id: number,initial_balance: number }[]}
     */
    const allSeasons = await seasons.toArray();
    console.log(allSeasons);
}

(async function() {
    
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
