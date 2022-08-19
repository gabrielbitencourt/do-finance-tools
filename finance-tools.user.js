// ==UserScript==
// @name         DOFinanceTools
// @version      1.11
// @description  Better finance visualization for dugout-online
// @author       Gabriel Bitencourt
// @require      https://unpkg.com/dexie/dist/dexie.min.js
// @require      https://code.jquery.com/ui/1.13.1/jquery-ui.min.js
// @require      https://cdn.jsdelivr.net/npm/echarts@5.3.2/dist/echarts.min.js
// @include      http*dugout-online.com/home/*
// @include      http*dugout-online.com/finances/*
// @grant        GM_addStyle
// @homepage     https://github.com/gabrielbitencourt/do-finance-tools
// @downloadURL  https://github.com/gabrielbitencourt/do-finance-tools/raw/main/finance-tools.user.js
// @updateURL    https://github.com/gabrielbitencourt/do-finance-tools/raw/main/finance-tools.user.js
// ==/UserScript==
'use strict';

/* eslint-disable-next-line */
if (GM_addStyle) {
    /* eslint-disable-next-line */
    GM_addStyle(`
    .ui-tab:hover:not(.ui-state-active) {
        background-color: #eaf1e8;
    }
    .ui-state-active {
        background-color: #dfe7df;
    }
    `);
}

// CONSTS
const syncVersionKey = 'DOFinanceTools.syncVersion';
const lastMatchesUpdateKey = 'DOFinanceTools.lastMatchesUpdate';
const lastTransfersUpdateKey = 'DOFinanceTools.lastTransfersUpdate';
const optionsKey = 'DOFinanceTools.options';

const clubName = document.querySelector('div.header_clubname')?.innerText;
const options = JSON.parse(localStorage.getItem(optionsKey)) ?? { sync: true, limiter: true };
const season40Start = '2021-08-17';

localStorage.setItem(optionsKey, JSON.stringify(options));

const eventTypes = {
    BUY: 1,
    SELL: 2,
    BUILDING: 4,
    MATCH: 3,
    OTHER: 5
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * @typedef {import('echarts').EChartsOption} EChartsOption
 * @typedef {import('dexie').Dexie} Dexie
 * @typedef {import('dexie').Table} Table
 * @typedef {{ id: number, initial_balance: number }} Season
 * @typedef {{ season_id: number, date: string, current: number, total_players_salary: number, total_coaches_salary: number, current_players_salary: number, current_coaches_salary: number, building: number, tickets: number, transfers: number, sponsor: number, prizes: number, maintenance: number, others:number }} Finance
 */

const parser = new window.DOMParser();
const formatter = new Intl.NumberFormat('pt-BR', { minimumIntegerDigits: 2 });
const timezone = Math.round((serverdate.getTime() - new Date().getTime()) / (3600 * 1000)) - (new Date().getTimezoneOffset() / 60);

/**
 * @type {Dexie}
 */
const db = new Dexie('DOFinanceDatabase');
db
    .version(4)
    .stores({
        season: '&id',
        finance: '[season_id+date+current]',
        events: '[season_id+date+type+id],type'
    });

/** @type {Table} */
const seasons = db.season;

/** @type {Table} */
const finances = db.finance;

/** @type {Table} */
const events = db.events;

/** @type {echarts.ECharts} */
let echartsContainer;

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
    22: ['current', 23]
};

/**
 * Convert string to number formatted
 * @param {string} n string to convert
 * @returns {number} number formatted
 */
const parseNumbers = (n) => parseInt(n.split(' ')[0].replace(/\./ug, ''), 10);

/**
 * Format number to string
 * @param {number} s number to format
 * @param {boolean} doubleZero if true, double zero will be added if number is zero
 * @returns {string} formatted string
 */
const formatNumbers = (s, doubleZero = false) => {
    if (s === 0) return (doubleZero ? '00' : '0');
    return formatter.format(s);
};

const serverDateString = (date = serverdate) => `${date.getFullYear()}-${date.getMonth() < 9 ? '0' : ''}${date.getMonth() + 1}-${date.getDate() < 10 ? '0' : ''}${date.getDate()}`;

const seasonStart = (season) => {
    const startDate = new Date(season40Start);
    const utc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()) + (140 * (season - 40) * MS_PER_DAY) + MS_PER_DAY;
    return new Date(utc).toISOString().split('T')[0];
};

const parseCurrentSeason = (dom) => parseInt(dom.querySelector('div.window_dialog_header').innerText.split(' ')[1], 10);


/**
 * Crawl finance page dom and save season and current finance infos
 * @param {Document} dom finance page dom
 * @returns {Promise<void>}
 */
const crawlInfos = async (dom) => {
    const elements = [...dom.querySelectorAll('td')].map((el) => el.innerText.trim()).filter((e) => e);
    const infos = elements.reduce((acc, _, index, arr) => {
        const indexInfo = indexes[index];
        if (indexInfo) {
            acc[indexInfo[0]] = parseNumbers(arr[indexInfo[1]]);
            if (indexInfo.length > 2) {
                const splitted = arr[indexInfo[3]].split(' ');
                acc[indexInfo[2]] = parseNumbers(splitted[splitted.length - 2]);
            }
        }
        return acc;
    }, {});

    const currentSeason = parseCurrentSeason(dom);
    const { initial_balance: initialBalance, ...save } = infos;
    await seasons.put({ initial_balance: initialBalance, id: currentSeason });
    const serverTime = new Date(serverdate);
    serverTime.setHours(serverTime.getHours() + timezone);
    await finances.put({
        season_id: currentSeason,
        date: serverDateString(serverTime),
        current: save.current,
        servertime: `${formatNumbers(serverTime.getHours(), true)}:${formatNumbers(serverTime.getMinutes(), true)}`,
        ...save
    });
};

const crawlMatches = async (season, past = false) => {
    if (options.limiter && localStorage.getItem(lastMatchesUpdateKey) === serverDateString()) return;

    const seasonStartDate = seasonStart(season);
    const nextSeasonStartDate = seasonStart(season + 1);
    const dateRange = [seasonStartDate, nextSeasonStartDate];
    let year = past ? parseInt(dateRange[0].split('-')[0], 10) : serverdate.getFullYear();
    let month = past ? parseInt(dateRange[0].split('-')[1], 10) : serverdate.getMonth() + 1;

    const parsers = [
        (el) => {
            const date = el.innerText.trim().split(' ')[1].split('.').reverse().join('-');
            let seasonId = season;
            if (date < seasonStartDate) seasonId = season - 1;
            else if (date > nextSeasonStartDate) seasonId = season + 1;

            return {
                date,
                season_id: seasonId,
                type: eventTypes.MATCH
            };
        },
        (match) => {
            const matchName = match.innerText.trim();
            try {
                return {
                    name: matchName,
                    friendly: (matchName.match(/\[(.*)\]/u) ?? [0, 0])[1] === 'Amistoso',
                    home: matchName.indexOf(clubName) < matchName.match(/(vs.|\d?\d:\d?\d)/u)?.index,
                    link: match.querySelector('a').href,
                    id: parseInt(match.querySelector('a').href.match(/gameid\/(\d*)\//ug)[0].split('/')[1], 10)
                };
            }
            catch (_) {
                return {
                    type: eventTypes.OTHER,
                    name: matchName,
                    id: 0
                };
            }
        },
        () => ({})
    ];
    const matches = [];
    while (year <= parseInt(dateRange[1].split('-')[0], 10) && month <= parseInt(dateRange[1].split('-')[1], 10)) {
        const response = await fetch(`https://www.dugout-online.com/calendar/none/year/${year}/month/${month < 10 ? `0${month}` : month}`, { method: 'GET' });
        const dom = parser.parseFromString(await response.text(), 'text/html');

        matches.push(...[...dom.querySelectorAll('tr.row_event')].map((el) => [...el.querySelectorAll('td')].reduce((acc, td, i) => ({ ...acc, ...parsers[i](td) }), {})));
        month++;
        if (month > 12) {
            month = 1;
            year++;
        }
    }
    await events.bulkPut(matches);
    localStorage.setItem(lastMatchesUpdateKey, serverDateString());
};

/**
 * Sort finances by date
 * @param {Finance} a first finance
 * @param {Finance} b second finance
 * @returns {number} -1 if a < b, 1 if a > b, 0 if a = b
 */
const sortFinances = (a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return a.servertime <= b.servertime ? -1 : 1;
};

/**
 * Get delta between each finance and the previous one for the specified fields
 * @param {Finance[]} infos finances to get delta from
 * @param {string[]} fields fields to get delta for
 * @returns {number[]} delta for each field
 */
const getDelta = (infos, fields) => infos.map((info, i, arr) => {
    if (i === 0) return undefined;
    return fields.reduce((acc, f) => acc + info[f] - arr[i - 1][f], 0);
});

/**
 * Get delta between each finance and the previous one for the specified fields and group by date
 * @param {Finance[]} infos finances to get delta from
 * @param {string[]} fields fields to get delta for
 * @returns {{ delta: number, date: string }[]} delta for each field grouped by date
 */
const getDeltaByDate = (infos, fields) => infos.map((info, i, arr) => {
    if (i === 0) return undefined;
    return { delta: fields.reduce((acc, f) => acc + info[f] - arr[i - 1][f], 0), date: info.date };
});

/**
 * Get daily sponsor value from the finances
 * @param {Finance[]} infos finances to get daily sponsor value from
 * @returns {number} daily sponsor value
 */
const getDailySponsor = (infos) => {
    const sponsors = getDelta(infos, ['sponsor']).filter((n) => !isNaN(n));
    if (!sponsors.length) return 0;
    return sponsors.sort((a, b) => sponsors.filter((v) => v === a).length - sponsors.filter((v) => v === b).length).pop();
};

const getAverageTickets = (infos, friendlies) => {
    const tickets = getDeltaByDate(infos, ['tickets'])
        .filter((t) => {
            if (!t?.delta) return false;
            return friendlies ? new Date(`${t.date}T00:00:00`).getDay() === 1 : new Date(`${t.date}T00:00:00`).getDay() !== 1;
        })
        .map((d) => d.delta);
    if (!tickets.length) return 0;
    return Math.round((tickets.reduce((a, b) => a + b, 0) / tickets.length));
};

const getLastMaintenance = (infos) => {
    const maintenance = getDelta(infos, ['maintenance']).filter((m) => m);
    if (!maintenance.length) return 0;
    return maintenance[maintenance.length - 1] * -1;
};

const getAverageOthers = (infos) => {
    const others = getDelta(infos, ['others']).filter((t) => t);
    if (!others.length) return 0;
    return Math.round(others.reduce((a, b) => a + b, 0) / others.length);
};

/**
 * Correct finances to have entries for every day of the week
 * @param {Finance[]} infos finances to correct
 * @returns {Finance[]} corrected finances
 */
const correctInfos = (infos) => {
    const corrected = [];
    for (let index = 0; index < infos.length; index++) {
        const info = infos[index];
        if (index === infos.length - 1) {
            corrected.push(info);
            break;
        }
        const next = infos[index + 1];
        if (info.date === next.date) continue;

        const diff = new Date(next.date).getTime() - new Date(info.date).getTime();
        if (diff === 0 || diff === 86400000) corrected.push(info);
        else if (diff > 86400000 && diff % 86400000 === 0) {
            corrected.push(info);
            const daily = getDailySponsor(infos);
            const daysBetween = diff / 86400000;
            if ((next.sponsor - info.sponsor) / daysBetween !== daily) continue;

            for (let d = 1; d < daysBetween; d++) {
                const date = new Date(info.date);
                date.setDate(date.getDate() + d + 1);
                corrected.push({
                    season_id: info.season_id,
                    date: `${date.getFullYear()}-${date.getMonth() < 9 ? '0' : ''}${date.getMonth() + 1}-${date.getDate() < 10 ? '0' : ''}${date.getDate()}`,
                    current: info.current + ((next.sponsor - info.sponsor) / daysBetween) * d,
                    total_players_salary: info.total_players_salary,
                    total_coaches_salary: info.total_coaches_salary,
                    current_players_salary: info.current_players_salary,
                    current_coaches_salary: info.current_coaches_salary,
                    building: info.building,
                    tickets: info.tickets,
                    transfers: info.transfers,
                    sponsor: info.sponsor + ((next.sponsor - info.sponsor) / daysBetween) * d,
                    prizes: info.prizes,
                    maintenance: info.maintenance,
                    others: info.others
                });
            }
        }
        else throw new Error('Diferença entre datas inesperada: ', next.date, info.date, diff);
    }

    // TO-DO: match tickets, buys and sells (and maybe salary) with events
    return corrected.map((f, i, arr) => {
        if (i === 0 || i === arr.length - 1) return f;
        const day = new Date(`${f.date}T00:00:00`).getDay();
        const mondayExpenses = f.total_players_salary + f.total_coaches_salary + f.others + f.maintenance;
        if (day === 1 && mondayExpenses === arr[i - 1].total_players_salary + arr[i - 1].total_coaches_salary + arr[i - 1].others + arr[i - 1].maintenance) {
            let indx = 0;
            while (mondayExpenses === arr[i + indx].total_players_salary + arr[i + indx].total_coaches_salary + arr[i + indx].others + arr[i + indx].maintenance) indx++;

            for (let ib = i + indx - 1; ib >= i; ib--) {
                const element = arr[ib];
                element.maintenance = arr[i + indx].maintenance;
                element.total_players_salary = arr[i + indx].total_players_salary;
                element.total_coaches_salary = arr[i + indx].total_coaches_salary;
                element.others = arr[i + indx].others;
                element.current = element.current + element.maintenance + element.total_coaches_salary + element.total_players_salary + element.others - mondayExpenses;
            }
        }
        return f;
    });
};

/**
 * Project finances for future dates based on averages from current finances (or provided averages)
 * @param {number} currentSeason current season number
 * @param {Finance[]} infos current finances
 * @param {number | null} sponsor average sponsor daily income value
 * @param {number | null} friendlies average friendlies ticket income value
 * @param {number | null} home average home ticket income value
 * @param {number | null} monday average monday expenses value
 * @returns {Finance[]} projected finances
 */
const projectFinances = async (currentSeason, infos, sponsor, friendlies, home, monday) => {
    const past = infos.filter((f) => f.date <= serverDateString());
    const reference = past[past.length - 1];

    const futureMatchesDates = (
        await events
            .where({ season_id: currentSeason, type: eventTypes.MATCH })
            .filter((m) => m.date >= serverDateString())
            .toArray()
    )
        .filter((m) => !m.name.includes('-Juvenil]') && m.home === true && !m.friendly)
        .map((m) => m.date)
        .reduce((acc, date) => ({ ...acc, [date]: true }), {});

    const dailySponsor = sponsor ? sponsor : getDailySponsor(past);
    const averageHomeTickets = !isNaN(home) ? home : getAverageTickets(past, false);
    const averageFriendliesTickets = !isNaN(friendlies) ? friendlies : getAverageTickets(past, true);
    const mondayExpenses = monday ? monday : reference.current_coaches_salary + reference.current_players_salary + getLastMaintenance(past) - getAverageOthers(past);

    const future = [];
    const day = new Date(`${serverDateString()}T00:00:00`);
    const nextSeasonStartDate = seasonStart(currentSeason + 1);
    while (serverDateString(day) < nextSeasonStartDate) {
        const last = future.length ? future[future.length - 1] : reference;
        future.push({
            season_id: currentSeason,
            date: serverDateString(day),
            total_players_salary: last.total_players_salary - (day.getDay() === 1 ? reference.current_players_salary : 0),
            total_coaches_salary: last.total_coaches_salary - (day.getDay() === 1 ? reference.current_coaches_salary : 0),
            current_players_salary: reference.current_players_salary,
            current_coaches_salary: reference.current_coaches_salary,
            building: last.building,
            tickets: last.tickets + (day.getDay() === 1 ? averageFriendliesTickets : 0) + (day.getDay() !== 1 && futureMatchesDates[serverDateString(day)] ? averageHomeTickets : 0),
            transfers: last.transfers,
            sponsor: last.sponsor + (serverDateString() !== serverDateString(day) ? dailySponsor : 0),
            prizes: last.prizes,
            maintenance: last.maintenance - (day.getDay() === 1 ? getLastMaintenance(past) : 0),
            others: last.others + (day.getDay() === 1 ? getAverageOthers(past) : 0),
            current: last.current + dailySponsor - (day.getDay() === 1 ? mondayExpenses - averageFriendliesTickets : 0) + (day.getDay() !== 1 && futureMatchesDates[serverDateString(day)] ? averageHomeTickets : 0)
        });
        day.setDate(day.getDate() + 1);
    }
    return [future, dailySponsor, averageHomeTickets, averageFriendliesTickets, mondayExpenses];
};

const marker = (color) => `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${color};"></span>`;
const tooltipSpan = (value) => `<span style="float: right; font-weight: bold;">${value} £</span>`;

/**
 * Setup finances table from finances
 * @param {number} currentSeason current season number
 * @param {number} initialBalance initial balance
 * @param {Finance[]} infos finances
 * @returns {string} html table
 */
const setupInfos = (currentSeason, initialBalance, infos) => {
    let template = `
        <center>
            <div class="window_dialog" style="width: 920px; padding: 4px; text-align: center;">
                <div class="window_dialog_header" style="width: 910px; text-align: left;">&nbsp;Temporada @currentSeason</div>
                <div class="row3"
                    style="margin-top: 2px; width: 918px; font-weight: bold; border: 1px solid #ced5cd; moz-border-radius: 3px 3px 3px 3px; border-radius: 3px 3px 3px 3px;">
                    <table width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tbody>
                            <tr>
                                <td valign="middle" align="right" width="40%"
                                    style="font-size: 16px; padding-top: 2px; padding-bottom: 2px;">
                                    Saldo inicial :&nbsp;
                                </td>
                                <td valign="middle" align="right" width="120" style="font-size: 16px;">&nbsp;
                                    @initial_balance £
                                </td>
                                <td valign="middle" align="left" style="font-size: 16px;">&nbsp;</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="row1"
                    style="margin-top: 0px; width: 918px; font-weight: normal; border: 1px solid #ffffff; moz-border-radius: 3px 3px 3px 3px; border-radius: 3px 3px 3px 3px;">
                    <table width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tbody>
                            <tr>
                                <td valign="middle" align="right" width="40%"
                                    style="padding-top: 2px; padding-bottom: 2px; font-size: 16px;">
                                    Salários dos jogadores :&nbsp;
                                </td>
                                <td valign="middle" align="right" width="120" style="font-size: 16px;">&nbsp;
                                    <span style="color: #aa0000;">@total_players_salary £</span>
                                </td>
                                <td valign="middle" align="left" style="font-size: 14px;">&nbsp;
                                    (atualmente em @current_players_salary £/semana)
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="row2"
                    style="margin-top: -1px; width: 918px; font-weight: normal; border: 1px solid #ffffff; moz-border-radius: 3px 3px 3px 3px; border-radius: 3px 3px 3px 3px;">
                    <table width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tbody>
                            <tr>
                                <td valign="middle" align="right" width="40%"
                                    style="padding-top: 2px; padding-bottom: 2px; font-size: 16px;">
                                    Salários da comissão técnica :&nbsp;
                                </td>
                                <td valign="middle" align="right" width="120" style="font-size: 16px;">&nbsp;
                                    <span style="color: #aa0000;">@total_coaches_salary £</span>
                                </td>
                                <td valign="middle" align="left" style="font-size: 14px;">&nbsp;
                                    (atualmente em @current_coaches_salary £/semana)
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="row1"
                    style="margin-top: -1px; width: 918px; font-weight: normal; border: 1px solid #ffffff; moz-border-radius: 3px 3px 3px 3px; border-radius: 3px 3px 3px 3px;">
                    <table width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tbody>
                            <tr>
                                <td valign="middle" align="right" width="40%"
                                    style="padding-top: 2px; padding-bottom: 2px; font-size: 16px;">
                                    Construção :&nbsp;
                                </td>
                                <td valign="middle" align="right" width="120" style="font-size: 16px;">&nbsp;
                                    <span style="color: #aa0000;">@building £</span>
                                </td>
                                <td valign="middle" align="left" style="font-size: 14px;">&nbsp;</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="row2"
                    style="margin-top: -1px; width: 918px; font-weight: normal; border: 1px solid #ffffff; moz-border-radius: 3px 3px 3px 3px; border-radius: 3px 3px 3px 3px;">
                    <table width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tbody>
                            <tr>
                                <td valign="middle" align="right" width="40%"
                                    style="padding-top: 2px; padding-bottom: 2px; font-size: 16px;">
                                    Bilheterias :&nbsp;
                                </td>
                                <td valign="middle" align="right" width="120" style="font-size: 16px;">&nbsp;
                                    @tickets £ </td>
                                <td valign="middle" align="left" style="font-size: 14px;">&nbsp;</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="row1"
                    style="margin-top: -1px; width: 918px; font-weight: normal; border: 1px solid #ffffff; moz-border-radius: 3px 3px 3px 3px; border-radius: 3px 3px 3px 3px;">
                    <table width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tbody>
                            <tr>
                                <td valign="middle" align="right" width="40%"
                                    style="padding-top: 2px; padding-bottom: 2px; font-size: 16px;">
                                    Transferências :&nbsp;
                                </td>
                                <td valign="middle" align="right" width="120" style="font-size: 16px;">&nbsp;
                                    <span style="color: #aa0000;">@transfers £</span>
                                </td>
                                <td valign="middle" align="left" style="font-size: 14px;">&nbsp;</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="row2"
                    style="margin-top: -1px; width: 918px; font-weight: normal; border: 1px solid #ffffff; moz-border-radius: 3px 3px 3px 3px; border-radius: 3px 3px 3px 3px;">
                    <table width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tbody>
                            <tr>
                                <td valign="middle" align="right" width="40%"
                                    style="padding-top: 2px; padding-bottom: 2px; font-size: 16px;">
                                    Patrocínios :&nbsp;
                                </td>
                                <td valign="middle" align="right" width="120" style="font-size: 16px;">&nbsp;
                                    @sponsor £ </td>
                                <td valign="middle" align="left" style="font-size: 14px;">&nbsp;</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="row1"
                    style="margin-top: -1px; width: 918px; font-weight: normal; border: 1px solid #ffffff; moz-border-radius: 3px 3px 3px 3px; border-radius: 3px 3px 3px 3px;">
                    <table width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tbody>
                            <tr>
                                <td valign="middle" align="right" width="40%"
                                    style="padding-top: 2px; padding-bottom: 2px; font-size: 16px;">
                                    Premiações :&nbsp;
                                </td>
                                <td valign="middle" align="right" width="120" style="font-size: 16px;">&nbsp;
                                    @prizes £ </td>
                                <td valign="middle" align="left" style="font-size: 14px;">&nbsp;</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="row2"
                    style="margin-top: -1px; width: 918px; font-weight: normal; border: 1px solid #ffffff; moz-border-radius: 3px 3px 3px 3px; border-radius: 3px 3px 3px 3px;">
                    <table width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tbody>
                            <tr>
                                <td valign="middle" align="right" width="40%"
                                    style="padding-top: 2px; padding-bottom: 2px; font-size: 16px;">
                                    Manutenção :&nbsp;
                                </td>
                                <td valign="middle" align="right" width="120" style="font-size: 16px;">&nbsp;
                                    <span style="color: #aa0000;">@maintenance £</span>
                                </td>
                                <td valign="middle" align="left" style="font-size: 14px;">&nbsp;</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="row1"
                    style="margin-top: -1px; width: 918px; font-weight: normal; border: 1px solid #ffffff; moz-border-radius: 3px 3px 3px 3px; border-radius: 3px 3px 3px 3px;">
                    <table width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tbody>
                            <tr>
                                <td valign="middle" align="right" width="40%"
                                    style="padding-top: 2px; padding-bottom: 2px; font-size: 16px;">
                                    Diversos :&nbsp;
                                </td>
                                <td valign="middle" align="right" width="120" style="font-size: 16px;">&nbsp;
                                    <span style="color: #aa0000;">@others £</span>
                                </td>
                                <td valign="middle" align="left" style="font-size: 14px;">&nbsp;</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="row4"
                    style="margin-top: 0px; width: 918px; font-weight: bold; border: 1px solid #ced5cd; moz-border-radius: 3px 3px 3px 3px; border-radius: 3px 3px 3px 3px;">
                    <table width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tbody>
                            <tr>
                                <td valign="middle" align="right" width="40%"
                                    style="font-size: 16px; padding-top: 2px; padding-bottom: 2px;">
                                    Saldo atual :&nbsp;
                                </td>
                                <td valign="middle" align="right" width="120" style="font-size: 16px;">&nbsp;
                                    @current £ </td>
                                <td valign="middle" align="left" style="font-size: 16px;">&nbsp;</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            <div id="echarts-@currentSeason" style="width: 910px;">Clique para carregar gráfico</div>
        </center>
    `;
    template = template.replace(/@currentSeason/ug, currentSeason);
    template = template.replace(/@initial_balance/ug, formatNumbers(initialBalance));
    for (const key in infos[infos.length - 1]) {
        if (Object.prototype.hasOwnProperty.call(infos[infos.length - 1], key)) {
            const element = infos[infos.length - 1][key];
            template = template.replace(new RegExp(`@${key} `, 'ug'), `${formatNumbers(element)} `);
        }
    }
    return template;
};

/**
 * Setup echarts instance from current finances and future finance projections, if any
 * @param {Finance[]} rawData current finances
 * @param {Finance[]} projections future finance projections
 * @returns {EChartsOption} echarts option
 */
const setupChart = (rawData, projections = []) => {
    const data = rawData.filter((f, i, arr) => {
        if (i === 0) return true;
        for (const key in f) {
            if (key === 'date') continue;
            const element = f[key];
            const prev = arr[i - 1][key];
            if (element !== prev) return true;
        }
        return false;
    }).concat(projections);

    const salarios = data
        .map((d, i, arr) => {
            if (i !== 0 && d.total_players_salary + d.total_coaches_salary !== arr[i - 1].total_players_salary + arr[i - 1].total_coaches_salary) return d.current_players_salary + d.current_coaches_salary;
            return undefined;
        });
    const contrucoes = data.map((d, i, arr) => {
        if (i !== 0 && d.building !== arr[i - 1].building) return (d.building - arr[i - 1].building) * -1;
        return undefined;
    });
    const manutencao = data.map((d, i, arr) => {
        if (i !== 0 && d.maintenance !== arr[i - 1].maintenance) return (d.maintenance - arr[i - 1].maintenance) * -1;
        return undefined;
    });

    const diversos = data.map((d, i, arr) => {
        if (i !== 0 && d.others !== arr[i - 1].others) return d.others - arr[i - 1].others;
        return undefined;
    });
    const transferencias = data.map((d, i, arr) => {
        if (i !== 0 && d.transfers !== arr[i - 1].transfers) return d.transfers - arr[i - 1].transfers;
        return undefined;
    });

    const tickets = data.map((d, i, arr) => {
        if (i !== 0 && d.tickets !== arr[i - 1].tickets) return d.tickets - arr[i - 1].tickets;
        return undefined;
    });
    const patrocinios = data.map((d, i, arr) => {
        if (i !== 0 && d.sponsor !== arr[i - 1].sponsor) return d.sponsor - arr[i - 1].sponsor;
        return undefined;
    });

    const xAxisData = data.map((d) => d.date);
    const doubleVision = true;
    const echartsOptions = {
        tooltip: {
            trigger: 'axis',
            textStyle: {
                align: 'left'
            },
            position: (pos) => {
                const obj = { top: 10 };
                obj[['left', 'right'][+(pos[0] < (650))]] = 30;
                return obj;
            },
            extraCssText: 'width: 200px;',
            formatter: (params) => {
                const projection = params[0].dataIndex > data.length - projections.length - 1;
                if (doubleVision && params[0].axisIndex === 0) params.push(...params.splice(0, 2));

                const despesas = params.slice(0, 5);
                const tooltip = [];
                if (projection) tooltip.push('<div style="font-size: 11px; font-weight: bold;">Projeção!<br/>(Baseado nas médias coletadas)</div>');
                for (const param of despesas) if (param.data) tooltip.push(`${param.marker}${param.seriesName}: ${tooltipSpan(formatNumbers(param.data))}`);

                const totalDespesas = despesas.reduce((a, b) => a + (isNaN(b.data) ? 0 : b.data), 0);
                const receitas = params.slice(5, 9);
                const totalReceitas = receitas.reduce((a, b) => a + (isNaN(b.data) ? 0 : b.data), 0);

                tooltip.push(`${despesas.some((r) => !isNaN(r.data)) ? '<hr size=1 style="margin: 3px 0">' : ''}${marker('red')}Total de despesas: ${tooltipSpan(formatNumbers(totalDespesas))}<br/>`);

                for (const param of receitas) if (param.data) tooltip.push(`${param.marker}${param.seriesName}: ${tooltipSpan(formatNumbers(param.data))}`);
                tooltip.push(`${receitas.some((r) => !isNaN(r.data)) ? '<hr size=1 style="margin: 3px 0">' : ''}${marker('green')}Total de receitas: ${tooltipSpan(formatNumbers(totalReceitas))}<br/>`);

                const offset = 11 - params.length;
                tooltip.push(`${params[(!projection ? 9 : 10) - offset].marker}${params[(!projection ? 9 : 10) - offset].seriesName}: ${tooltipSpan(formatNumbers(params[(!projection ? 9 : 10) - offset].data))}`);
                if (totalReceitas === totalDespesas) tooltip.push(`${params[(!projection ? 9 : 10) - offset].marker}${!projection ? 'Variação' : 'Projeção'} do dia: ${tooltipSpan(formatNumbers(totalReceitas - totalDespesas))}`);
                else tooltip.push(`${totalReceitas - totalDespesas > 0 ? marker('green') : marker('red')}${!projection ? 'Variação' : 'Projeção'} do dia: ${tooltipSpan(formatNumbers(totalReceitas - totalDespesas))}`);
                return tooltip.join('<br/>');
            }
        },
        legend: {
            bottom: 0, width: '100%'
        },
        grid: [
            {
                top: '7%',
                left: '10%',
                right: '1%',
                height: '71%'
            }
        ],
        xAxis: [
            {
                type: 'category',
                gridIndex: 0,
                axisLine: { onZero: false },
                axisTick: { show: false },
                data: xAxisData,
                axisLabel: {
                    formatter: (value) => value.split('-').reverse().join('/')
                },
                axisPointer: {
                    type: 'shadow',
                    label: {
                        show: true,
                        formatter: (params) => params.value.split('-').reverse().join('/')
                    }
                }
            }
        ],
        yAxis: [
            {
                type: 'value',
                min: 0,
                max: 'dataMax',
                gridIndex: 0,
                axisLabel: {
                    formatter: (value) => `${formatNumbers(value)} £`
                },
                axisPointer: {
                    type: 'line',
                    label: {
                        show: true
                    }
                }
            }
        ],
        dataZoom: {
            type: 'slider',
            top: '83%',
            xAxisIndex: [0],
            height: '5%',
            start: 0,
            end: 100
        },
        series: [
            {
                data: salarios,
                type: 'bar',
                stack: 'Despesas',
                name: 'Salários',
                color: '#660708',
                yAxisIndex: 0,
                xAxisIndex: 0
            },
            {
                data: transferencias.map((v) => (v > 0 ? undefined : v * -1)),
                type: 'bar',
                stack: 'Despesas',
                name: 'Compras',
                color: '#a4161a',
                yAxisIndex: 0,
                xAxisIndex: 0
            },
            {
                data: contrucoes,
                type: 'bar',
                stack: 'Despesas',
                name: 'Construções',
                color: '#ba181b',
                yAxisIndex: 0,
                xAxisIndex: 0
            },
            {
                data: manutencao,
                type: 'bar',
                stack: 'Despesas',
                name: 'Manutenção',
                color: '#e5383b',
                yAxisIndex: 0,
                xAxisIndex: 0
            },
            {
                data: diversos.map((v) => (v > 0 ? undefined : v * -1)),
                type: 'bar',
                stack: 'Despesas',
                name: 'Outras despesas',
                color: '#EA5D5F',
                yAxisIndex: 0,
                xAxisIndex: 0
            },
            {
                data: patrocinios,
                type: 'bar',
                stack: 'Receitas',
                name: 'Patrocínios',
                color: '#143601',
                yAxisIndex: 0,
                xAxisIndex: 0
            },
            {
                data: transferencias.map((v) => (v > 0 ? v : undefined)),
                type: 'bar',
                stack: 'Receitas',
                name: 'Vendas',
                color: '#245501',
                yAxisIndex: 0,
                xAxisIndex: 0
            },
            {
                data: tickets,
                type: 'bar',
                stack: 'Receitas',
                name: 'Bilheterias',
                color: '#538d22',
                yAxisIndex: 0,
                xAxisIndex: 0
            },
            {
                data: diversos.map((v) => (v > 0 ? v : undefined)),
                type: 'bar',
                stack: 'Receitas',
                name: 'Outras receitas',
                color: '#73a942',
                yAxisIndex: 0,
                xAxisIndex: 0
            },
            {
                data: [...data.slice(0, data.length - projections.length + 1).map((d) => d.current), ...projections.map(() => undefined)],
                type: 'line',
                name: 'Saldo atual',
                color: '#5470c6'
            },
            {
                data: [...data.slice(0, data.length - projections.length).map(() => undefined), ...projections.map((d) => d.current)],
                type: 'line',
                name: 'Saldo previsto',
                color: 'orange'
            }
        ]
    };
    if (doubleVision) {
        echartsOptions.axisPointer = {
            type: 'cross',
            link: { xAxisIndex: 'all' }
        };

        echartsOptions.grid[0].height = '20%';
        echartsOptions.grid.push({
            top: '32%',
            left: '10%',
            right: '1%',
            bottom: '10%',
            height: '46%'
        });

        echartsOptions.xAxis.axisLabel = { show: false };
        echartsOptions.xAxis.push({
            type: 'category',
            gridIndex: 1,
            data: xAxisData,
            axisLabel: {
                formatter: (value) => value.split('-').reverse().join('/')
            },
            axisPointer: {
                type: 'shadow'
            }
        });

        echartsOptions.yAxis[0].min = 'dataMin';
        echartsOptions.yAxis[0].splitArea = { show: true };
        echartsOptions.yAxis.push({
            type: 'value',
            gridIndex: 1,
            axisLabel: {
                formatter: (value) => `${formatNumbers(value)} £`
            },
            axisPointer: {
                type: 'line',
                label: {
                    show: true
                }
            }
        });

        echartsOptions.dataZoom.xAxisIndex = [0, 1];

        echartsOptions.series = echartsOptions.series.map((s) => {
            if (s.xAxisIndex === 0) {
                s.xAxisIndex = 1;
                s.yAxisIndex = 1;
            }
            return s;
        });

    }
    return echartsOptions;
};

const setupInput = (name, value) => {
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.flexDirection = 'column';
    div.style.marginRight = '4px';

    const input = document.createElement('input');
    input.placeholder = name;
    input.type = 'number';
    input.value = value;
    input.style.maxWidth = '120px';

    const label = document.createElement('label');
    label.innerText = name;
    label.style.cssText = `
        font-size: 12px;
        font-weight: bold;
    `;
    div.appendChild(label);
    div.appendChild(input);
    return div;
};

const map = ['date', 'servertime', 'season_id', 'current', 'total_players_salary', 'total_coaches_salary', 'current_players_salary', 'current_coaches_salary', 'building', 'tickets', 'transfers', 'sponsor', 'prizes', 'maintenance', 'others'];
const dateEncoder = (x) => x.replace(':', '-').split('-').map((m) => parseInt(m, 10).toString(36)).join('-');
const numberEncoder = (x) => parseInt(x, 10).toString(36);

const encodeFinances = async (season_id) => {
    const fin = (await finances.where({ season_id }).toArray())
        .sort(sortFinances)
        .map((row, rowIndex, rows) =>
            Object
                .entries(row)
                .reduce((acc, [key, value]) => {
                    const i = map.indexOf(key);
                    if (key !== 'date' && rowIndex > 0 && rows[rowIndex - 1][key] === value) acc[i] = '';
                    else if (i >= 0) acc[i] = i > 1 ? numberEncoder(value) : dateEncoder(value);
                    return acc;
                }, []));
    const encoded = JSON.stringify(fin).replace(/"/ug, '').replace(/\],\[/ug, '|').replace(/(\[\[|\]\])/ug, '');
    return encoded;
};

/**
 * Decode saved finances from csv base36 format
 * @returns {Promise<string[]>} array of decoded finances
 */
const decodeFinances = async () => {
    if (!options.sync) return [];
    const response = await fetch('https://www.dugout-online.com/notebook/none', { method: 'GET' });
    const dom = parser.parseFromString(await response.text(), 'text/html');
    const textarea = dom.querySelector('textarea.textfield[name="editedContents"]');
    if (!textarea) {
        options.sync = false;
        localStorage.setItem(optionsKey, JSON.stringify(options));
        return [];
    }

    const notes = textarea.value.split('DOFinanceTools\n=====\n');
    if (notes.length < 2) return notes;

    const parts = notes[1].split('\n');
    if (parts.length < 2) return notes;
    const syncVersion = parts[0];
    const value = parts[1];
    const mapped = value
        .split('|')
        .map((line) => line
            .split(',')
            .map((v, i) => {
                if (v === '') return null;
                if (i > 1) return parseInt(v, 36);
                return v.split('-')
                    .map((d) => (d === 'null' ? '00:00' : formatNumbers(parseInt(d, 36)).replace('.', '')))
                    .join(i === 0 ? '-' : ':');
            })
            .reduce((acc, v, i) => ({ ...acc, [map[i]]: v }), {}))
        .map((row, index, rows) => {
            for (const key in row) if (row[key] === null) row[key] = rows[index - 1][key];
            return row;
        });
    return [
        notes[0].replace(/ *\[Não escreva abaixo dessa linha\]/ug, ''),
        syncVersion,
        mapped,
        value
    ];
};

/**
 * Saves encoded finances to notepad with notes
 * @param {*} notes notes to save before encoded finances
 * @param {*} encoded encoded finances to save
 * @returns {Promise<void>}
 */
const saveAtNotepad = async (notes, encoded) => {
    if (!options.sync) return;

    const syncVersion = serverdate.getTime();
    localStorage.setItem(syncVersionKey, syncVersion);
    const body = new FormData();
    body.append('savechanges', 1);
    body.append('editedContents', `${notes}[Não escreva abaixo dessa linha] DOFinanceTools\n=====\n${syncVersion}\n${encoded}`);
    fetch('https://www.dugout-online.com/notebook/none', {
        body,
        method: 'POST',
        mode: 'same-origin',
        credentials: 'include'
    });
};

const sync = async (season_id) => {
    if (!options.sync) return false;
    const [_, version, decoded, raw] = await decodeFinances();
    const toSync = version > localStorage.getItem(syncVersionKey) || !localStorage.getItem(syncVersionKey) || !version || raw !== (await encodeFinances(season_id));
    if (toSync && decoded) {
        await finances.bulkPut(decoded);
        return true;
    }
    return false;
};

const save = async (season_id) => {
    const [notes, version, _, raw] = await decodeFinances();
    const encoded = await encodeFinances(season_id);
    if (encoded === raw) localStorage.setItem(syncVersionKey, version);
    else if (encoded) await saveAtNotepad(notes, encoded);
};

/**
 * Render echarts graph for season inside container
 * @param {number} forSeason season to render graph for
 * @param {number} currentSeason current season
 * @param {HTMLDivElement} container container to render graph in
 * @returns {Promise<void>}
 */
const setupEcharts = async (forSeason, currentSeason, container) => {
    const infos = (await finances.where({ season_id: forSeason }).toArray()).sort(sortFinances);
    const correctedInfos = correctInfos(infos);
    const projections = forSeason !== currentSeason ? [] : (await projectFinances(forSeason, correctedInfos));

    container.style.height = '500px';
    container.style.width = '910px';
    const echartsInstance = echarts.init(container);
    echartsInstance.setOption(setupChart(correctedInfos, projections.length ? projections[0].slice(1) : []), true);

    if (forSeason !== currentSeason) return;
    echartsContainer = echartsInstance;

    const titleCss = `
        margin: 8px 0;
        font-size: 14px;
        text-align: left;
    `;
    const btnCss = `
        text-align: center;
        background-position: right;
        padding-right: 4px;
        padding-left: 4px;
        margin-right: 4px;
        color: #393A39;
        font-weight: bold;
        border: 1px solid #A4B0A3;
        background-color: #D5E3D5;
        -moz-border-radius: 4px 4px 4px 4px;
        border-radius: 4px 4px 4px 4px;
        cursor: pointer;
        align-self: end;
    `;

    const inputDiv = document.createElement('div');
    inputDiv.style.display = 'flex';
    inputDiv.style.textAlign = 'left';

    const sponsorInput = setupInput('Patrocínio diário', projections[1]);
    const ticketsInput = setupInput('Bilheteria em casa', projections[2]);
    const friendliesInput = setupInput('Bilheteria amistosos', projections[3]);
    const mondayInput = setupInput('Despesas de segunda', projections[4]);

    inputDiv.appendChild(sponsorInput);
    inputDiv.appendChild(ticketsInput);
    inputDiv.appendChild(friendliesInput);
    inputDiv.appendChild(mondayInput);

    const updateProjectionsBtn = document.createElement('button');
    updateProjectionsBtn.innerText = 'Atualizar';
    updateProjectionsBtn.style.cssText = btnCss;
    updateProjectionsBtn.onclick = async () => {
        const updated = await projectFinances(forSeason, correctedInfos, sponsorInput.lastElementChild.valueAsNumber, friendliesInput.lastElementChild.valueAsNumber, ticketsInput.lastElementChild.valueAsNumber, mondayInput.lastElementChild.valueAsNumber);
        echartsContainer.setOption(setupChart(correctedInfos, updated[0].slice(1)), true);
    };
    inputDiv.appendChild(updateProjectionsBtn);

    const titleVars = document.createElement('h6');
    titleVars.innerText = 'Variáveis de projeção';
    titleVars.style.cssText = titleCss;
    container.parentElement.appendChild(titleVars);
    container.parentElement.appendChild(inputDiv);

    const optionsDiv = document.createElement('div');
    optionsDiv.style.display = 'flex';
    optionsDiv.style.textAlign = 'left';

    const titleOpts = document.createElement('h6');
    titleOpts.innerText = 'Opções';
    titleOpts.style.cssText = titleCss;

    const backupBtn = document.createElement('button');
    backupBtn.innerText = 'Backup';
    backupBtn.style.cssText = btnCss;
    backupBtn.onclick = async () => {
        const backup = {
            finance: await finances.toArray(),
            season: await seasons.toArray(),
            event: await events.toArray()
        };
        const backupStr = JSON.stringify(backup);
        const backupBlob = new Blob([backupStr], { type: 'text/plain' });
        const backupUrl = URL.createObjectURL(backupBlob);
        const backupLink = document.createElement('a');
        backupLink.href = backupUrl;
        backupLink.download = `backupDOFinanceTools${serverDateString()}.json`;
        backupLink.click();
    };

    const importBtn = document.createElement('button');
    importBtn.innerText = 'Importar';
    importBtn.style.cssText = btnCss;
    importBtn.onclick = async () => {
        const f = document.createElement('input');
        f.type = 'file';
        f.onchange = () => {
            const file = f.files[0];
            const reader = new FileReader();
            reader.onload = async () => {
                const backup = JSON.parse(reader.result);
                await finances.bulkPut(backup.finance);
                await seasons.bulkPut(backup.season);
                await events.bulkPut(backup.event);
            };
            reader.readAsText(file);
        };
        f.click();
    };

    const clearBtn = document.createElement('button');
    clearBtn.innerText = 'Limpar dados';
    clearBtn.style.cssText = btnCss;
    clearBtn.onclick = async () => {
        await finances.clear();
        await seasons.clear();
        await events.clear();
        localStorage.removeItem(syncVersionKey);
        localStorage.removeItem(lastMatchesUpdateKey);
        localStorage.removeItem(lastTransfersUpdateKey);
    };

    const updateBtn = document.createElement('button');
    updateBtn.innerText = 'Atualizar dados';
    updateBtn.style.cssText = btnCss;
    updateBtn.onclick = async () => {
        localStorage.removeItem(lastMatchesUpdateKey);
        localStorage.removeItem(lastTransfersUpdateKey);

        const response = await fetch('https://www.dugout-online.com/finances/none/', { method: 'GET' });
        const dom = parser.parseFromString(await response.text(), 'text/html');
        await crawlInfos(dom);
        await crawlMatches(currentSeason, true);
        if (await sync(forSeason)) save(forSeason);
    };

    optionsDiv.appendChild(updateBtn);
    optionsDiv.appendChild(clearBtn);
    optionsDiv.appendChild(backupBtn);
    optionsDiv.appendChild(importBtn);

    if (options.development) {
        container.parentElement.appendChild(titleOpts);
        container.parentElement.appendChild(optionsDiv);
    }
};

const updateFinanceUI = async () => {
    const currentSeason = parseInt(document.querySelector('div.window_dialog_header').innerText.split(' ')[1], 10);

    /** @type {Season[]} */
    const allSeasons = (await seasons.toArray()).sort((a, b) => (a.id > b.id ? -1 : 1));
    const frame = document.querySelector('.window1_content_inside');

    const currentSeasonTab = frame.children[0];

    const ech = document.createElement('div');
    ech.id = `echarts-${currentSeason}`;

    currentSeasonTab.appendChild(ech);
    setupEcharts(currentSeason, currentSeason, ech);

    frame.removeChild(currentSeasonTab);

    const tabs = document.createElement('ul');
    if (allSeasons.length === 1) tabs.style.display = 'none';
    else tabs.style.display = 'flex';
    tabs.style.paddingLeft = '0';

    frame.appendChild(tabs);
    for (const season of allSeasons) {
        const seasonTab = document.createElement('li');
        seasonTab.style.cssText = `
            list-style: none;
            border: 1px solid #dfe6de;
            text-align: center;
            color: #444444;
            text-align: center;
        `;
        seasonTab.innerHTML = `<a style="text-decoration: none; padding: 8px; display: inline-block;" href="#tab-${season.id}">Temporada ${season.id}</a>`;
        tabs.appendChild(seasonTab);

        const seasonContent = document.createElement('div');
        seasonContent.id = `tab-${season.id}`;

        if (season.id === currentSeason) seasonContent.appendChild(currentSeasonTab);
        else {
            seasonContent.innerHTML = setupInfos(season.id, season.initial_balance, (await finances.where({ season_id: season.id }).toArray()).sort(sortFinances)); // fix: não é sort, é filtro/realocacao de repeticoes

            const click = seasonContent.querySelector(`#echarts-${season.id}`);
            click.onclick = () => setupEcharts(season.id, currentSeason, click).then();
        }
        frame.appendChild(seasonContent);
    }

    $(frame).tabs();
};

(async function() {
    if (!clubName) return;
    const isFinanceScreen = window.location.pathname.slice(1).split('/')[0] === 'finances';
    const dom = isFinanceScreen ? document : parser.parseFromString(await (await fetch('https://www.dugout-online.com/finances/none/', { method: 'GET' })).text(), 'text/html');
    const currentSeason = parseCurrentSeason(dom);

    const toSync = await sync(currentSeason);

    await crawlInfos(dom);
    await crawlMatches(currentSeason);
    if (isFinanceScreen) await updateFinanceUI();

    if (toSync) save(currentSeason);
}());
