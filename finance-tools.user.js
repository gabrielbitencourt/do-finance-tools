// ==UserScript==
// @name         DOFinanceTools
// @version      1.1
// @description  Better finance visualization for dugout-online
// @author       Gabriel Bitencourt
// @require      https://unpkg.com/dexie/dist/dexie.min.js
// @require      https://code.jquery.com/ui/1.13.1/jquery-ui.min.js
// @require      https://cdn.jsdelivr.net/npm/echarts@5.3.2/dist/echarts.min.js
// @include      http*dugout-online.com/home/*
// @include      http*dugout-online.com/finances/*
// @homepage     https://github.com/gabrielbitencourt/do-finance-tools
// @downloadURL  https://github.com/gabrielbitencourt/do-finance-tools/raw/main/finance-tools.user.js
// @updateURL    https://github.com/gabrielbitencourt/do-finance-tools/raw/main/finance-tools.user.js
// ==/UserScript==

const currentSeason = 41;
const seasonsStarts = {
    40: '2021-09-07',
    41: '2022-01-04',
    42: '2022-05-24'
};

const eventTypes = {
    BUY: 1,
    SELL: 2,
    BUILDING: 4,
    MATCH: 3
};

/**
 * @typedef {import('echarts').EChartsOption} EChartsOption
 * @typedef {import('dexie').Dexie} Dexie
 * @typedef {import('dexie').Table} Table
 * @typedef {{ id: number, initial_balance: number }} Season
 * @typedef {{ season_id: number, date: string, current: number, total_players_salary: number, total_coaches_salary: number, current_players_salary: number, current_coaches_salary: number, building: number, tickets: number, transfers: number, sponsor: number, prizes: number, maintenance: number, others:number }} Finance
 */

const parser = new window.DOMParser();
const formatter = new Intl.NumberFormat('pt-BR', { minimumIntegerDigits: 2 });

/**
 * @type {Dexie}
 */
const db = new Dexie("DOFinanceDatabase");
db.version(2).stores({
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
 * @param {number} s
 * @returns {string}
 */
const formatNumbers = (s, doubleZero = false) => s === 0 ? (doubleZero ? '00' : '0') : formatter.format(s);

const serverDateString = (date = serverdate) => `${date.getFullYear()}-${date.getMonth() < 9 ? '0' : ''}${date.getMonth() + 1}-${date.getDate() < 10 ? '0' : ''}${date.getDate()}`;

const countMondays = (d0, d1) => {
    const weekday = 1;
    const ndays = 1 + Math.round((d1 - d0) / (24 * 3600 * 1000));
    return Math.floor((ndays + (d0.getDay() + 6 - weekday) % 7) / 7)
}

/**
 * 
 * @param {Document} dom 
 */
const crawlInfos = async (dom) => {
    const elements = [...dom.querySelectorAll('td')].map(el => el.innerText.trim()).filter(e => e);
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

    const currentSeason = parseInt(dom.querySelector('div.window_dialog_header').innerText.split(' ')[1]);
    const { initial_balance, ...save } = infos;
    await seasons.put({ initial_balance: initial_balance, id: currentSeason });
    await finances.put({
        season_id: currentSeason,
        date: serverDateString(),
        current: save.current,
        servertime: formatNumbers(serverdate.getHours(), true) + ':' + formatNumbers(serverdate.getMinutes(), true),
        ...save
    });
}

const crawlMatches = async (season, past = false) => {
    if (localStorage.getItem('last_matches_crawl') === serverDateString()) return;
    const dateRange = [seasonsStarts[season], seasonsStarts[season + 1]];
    let year = past ? parseInt(dateRange[0].split('-')[0]) : serverdate.getFullYear();
    let month = past ? parseInt(dateRange[0].split('-')[1]) : serverdate.getMonth() + 1;

    const parsers = [
        (el) => {
            const date = el.innerText.trim().split(' ')[1].split('.').reverse().join('-');
            return {
                date: date,
                season_id: date < seasonsStarts[season] ? season - 1 : date > seasonsStarts[season + 1] ? season + 1 : season,
                type: eventTypes.MATCH
            };
        },
        (match) => ({ name: match.innerText.trim(), link: match.querySelector('a').href, id: parseInt(match.querySelector('a').href.match(/gameid\/(\d*)\//g)[0].split('/')[1]) }),
        (_) => ({})
    ];
    const matches = [];
    while (year <= parseInt(dateRange[1].split('-')[0]) && month <= parseInt(dateRange[1].split('-')[1])) {
        const response = await fetch(`https://www.dugout-online.com/calendar/none/year/${year}/month/${month < 10 ? `0${month}` : month}`, { method: 'GET' });
        const dom = parser.parseFromString(await response.text(), 'text/html');
    
        matches.push(...[...dom.querySelectorAll('tr.row_event')].map(el => [...el.querySelectorAll('td')].reduce((acc, td, i) => ({ ...acc, ...parsers[i](td) }), {})));
        month++;
        if (month > 12)
        {
            month = 1;
            year++;
        }
    }
    await events.bulkPut(matches);
    localStorage.setItem('last_matches_crawl', serverDateString());
};

const crawlTransfers = async () =>
{
    if (localStorage.getItem('last_transfers_crawl') === serverDateString()) return;
    const lastDate = (await events.where('type').equals(eventTypes.MATCH).last())?.date;
    const buys = [];
    const sells = [];
    
    const parsers = [
        (position) => ({ position: position.innerText.trim() }),
        (player) => ({ name: player.innerText.trim(), link: player.querySelector('a').href, id: parseInt(player.querySelector('a').href.split('/').reverse()[0]) }),
        (team) => ({ team: team.innerText.trim() }),
        (el, type) => {
            const date = el.innerText.trim().split('.').reverse().join('-');
            return {
                date,
                type,
                season_id: parseInt(Object.entries(seasonsStarts).find(([_, v], index, entries) => date >= v && (index === entries.length - 1 || date < entries[index + 1][1]))[0])
            };
        },
        (price) => ({ price: parseInt(price.innerText.trim().split(' ')[0].replace(/\./, '')) })
    ];

    let page = `https://www.dugout-online.com/clubinfo/transfers/clubid/none/typ/1/pg/1`;
    let pagesLeft;
    do
    {
        response = await fetch(page, { method: 'GET' });
        dom = parser.parseFromString(await response.text(), 'text/html');
        if (!pagesLeft) pagesLeft = [...dom.querySelectorAll('.pages_on ~ .pages_off')].map(el => el.onclick.toString()).reverse()
        
        buys.push(...[...dom.querySelector('tr.table_top_row').parentElement.children].slice(1).map(el => [...el.querySelectorAll('td')].reduce((acc, td, i) => ({ ...acc, ...parsers[i](td, i === 3 ? eventTypes.BUY : undefined) }), {})));
    } while (page = pagesLeft.pop() && (!lastDate || buys[buys.length - 1].date <= lastDate));

    pagesLeft = undefined;
    page = `https://www.dugout-online.com/clubinfo/transfers/clubid/none/typ/2/pg/1`;
    do
    {
        response = await fetch(page, { method: 'GET' });
        dom = parser.parseFromString(await response.text(), 'text/html');
        if (!pagesLeft) pagesLeft = [...dom.querySelectorAll('.pages_on ~ .pages_off')].map(el => el.onclick.toString()).reverse()

        sells.push(...[...dom.querySelector('tr.table_top_row').parentElement.children].slice(1).map(el => [...el.querySelectorAll('td')].reduce((acc, td, i) => ({ ...acc, ...parsers[i](td, i === 3 ? eventTypes.SELL : undefined) }), {})));
    } while (page = pagesLeft.pop() && (!lastDate || sells[sells.length - 1].date <= lastDate));

    localStorage.setItem('last_transfers_crawl', serverDateString());
    await events.bulkPut([...buys, ...sells]);
};

/**
 * 
 * @param {Finance[]} infos
 * @param {string[]} fields
 * @returns {number[]}
 */
const getDelta = (infos, fields) =>
{
    return infos.map((info, i, arr) =>
    {
        if (i === 0) return undefined;
        return fields.reduce((acc, f) => acc + info[f] - arr[i - 1][f], 0);
    });
}

/**
 * 
 * @param {Finance[]} infos
 * @return {number}
 */
const getDailySponsor = (infos) => {
    const sponsors = getDelta(infos, ['sponsor']).filter(n => !isNaN(n));
    return sponsors.sort((a, b) => sponsors.filter(v => v === a).length - sponsors.filter(v => v === b).length).pop();
}

const getAverageTickets = (infos) =>
{
    const tickets = getDelta(infos, ['tickets']).filter(t => t);
    return tickets.reduce((a, b) => a + b, 0) / tickets.length;
}

const getLastMaintenance = (infos) =>
{
    const maintenance = getDelta(infos, ['maintenance']).filter(m => m);
    return maintenance[maintenance.length - 1] * -1;
}

const getAverageOthers = (infos) =>
{
    const others = getDelta(infos, ['others']).filter(t => t);
    return others.reduce((a, b) => a + b, 0) / others.length;
}

/**
 * 
 * @param {Finance[]} infos
 * @return {Finance[]}
 */
const correctInfos = (infos) =>
{
    const corrected = [];
    for (let index = 0; index < infos.length; index++) {
        const info = infos[index];
        if (index === infos.length - 1)
        {
            corrected.push(info);
            // predict future
            break;
        }
        const next = infos[index + 1];
        if (info.date === next.date)
        {
            // merge
            continue;
        }
        
        const diff = new Date(next.date).getTime() - new Date(info.date).getTime();
        if (diff === 0 || diff === 86400000) corrected.push(info);
        else if (diff > 86400000 && diff % 86400000 === 0)
        {
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
        else console.error('Diferença entre datas inesperada: ', next.date, info.date, diff);
    }
    // assure maintenance, salary and others are always on monday - DONE
    // match tickets, buys and sells (and maybe salary) with events
    return corrected.map((f, i, arr) => 
    {
        if (i === 0 || i === arr.length - 1) return f;
        const day = new Date(f.date + 'T00:00:00').getDay();
        const mondayExpenses = f.total_players_salary + f.total_coaches_salary + f.others + f.maintenance;
        if (day === 1 && mondayExpenses === arr[i - 1].total_players_salary + arr[i - 1].total_coaches_salary + arr[i - 1].others + arr[i - 1].maintenance)
        {
            let index = 0;
            while (mondayExpenses === arr[i + index].total_players_salary + arr[i + index].total_coaches_salary + arr[i + index].others + arr[i + index].maintenance)
            {
                index++;
            }
            for (let ib = i + index - 1; ib >= i; ib--) {
                const element = arr[ib];
                element.maintenance = arr[i + index].maintenance;
                element.total_players_salary = arr[i + index].total_players_salary;
                element.total_coaches_salary = arr[i + index].total_coaches_salary;
                element.others = arr[i + index].others;
                element.current = element.current + element.maintenance + element.total_coaches_salary + element.total_players_salary + element.others - mondayExpenses
            }
        }
        return f;
    });
}

/**
 * 
 * @param {Finance[]} infos
 * @return {Finance[]}
 */
const predictFinances = async (infos) =>
{
    if (infos.length < 7) return [];
    const past = infos.filter(f => f.date < serverDateString());
    const reference = past[past.length - 1];
    
    const dailySponsor = getDailySponsor(past);
    const averageTickets = getAverageTickets(past);
    
    const futureMatchesDates = (await events.where({ season_id: currentSeason, type: eventTypes.MATCH }).filter(m => m.date >= serverDateString()).toArray()).filter(m => !m.name.includes("-Juvenil]")).map(m => m.date).reduce((acc, date) => ({ ...acc, [date]: true }), {});
    const mondayExpenses = reference.current_coaches_salary + reference.current_players_salary + getLastMaintenance(past) + getAverageOthers(past);

    // (daily sponsor * days_left) + (avg tickets * (matches_left + friendlies_count)) - (salaries + maintenance + others) * mondays_left;
    
    const future = [];
    const day = new Date(serverDateString() + 'T00:00:00');
    while (serverDateString(day) < seasonsStarts[currentSeason + 1])
    {
        const last = future.length ? future[future.length - 1] : reference;
        future.push({
            season_id: currentSeason,
            date: serverDateString(day),
            total_players_salary: last.total_players_salary - (day.getDay() === 1 ? reference.current_players_salary : 0),
            total_coaches_salary: last.total_coaches_salary - (day.getDay() === 1 ? reference.current_coaches_salary : 0),
            current_players_salary: reference.current_players_salary,
            current_coaches_salary: reference.current_coaches_salary,
            building: last.building,
            tickets: last.tickets + (day.getDay() === 1 ? averageTickets : 0) + (day.getDay() !== 1 && futureMatchesDates[serverDateString(day)] ? averageTickets : 0),
            transfers: last.transfers,
            sponsor: last.sponsor + dailySponsor,
            prizes: last.prizes,
            maintenance: last.maintenance - (day.getDay() === 1 ? getLastMaintenance(past) : 0),
            others: last.others + (day.getDay() === 1 ? getAverageOthers(past) : 0),
            current: last.current + dailySponsor - (day.getDay() === 1 ? mondayExpenses - averageTickets : 0) + (day.getDay() !== 1 && futureMatchesDates[serverDateString(day)] ? averageTickets : 0),
        });
        day.setDate(day.getDate() + 1);
    }
    return future;
}

const marker = (color) => `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${color};"></span>`;
const tooltipSpan = (value) => `<span style="float: right; font-weight: bold;">${value} £</span>`;

/**
 * 
 * @param {number} currentSeason
 * @param {Finance} infos
 */
const setupInfos = async (currentSeason, infos) => {
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
                                    @saldo_inicial £
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
            <div id="echarts-@currentSeason" style="width: 910px;"></div>
        </center>
    `;
    template = template.replace(/\@currentSeason/g, currentSeason);
    for (const key in infos) {
        const element = infos[key];
        template = template.replace(`@${key}`, formatNumbers(element));
    }
    return template;
}

/**
 * 
 * @param {Finance[]} rawData
 * @returns {EChartsOption}
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
    console.log(data);

    const salarios = data.map((d, i, arr) => i != 0 ? d.total_players_salary + d.total_coaches_salary != arr[i - 1].total_players_salary + arr[i - 1].total_coaches_salary ? (d.current_players_salary + d.current_coaches_salary) : undefined : undefined);
    const contrucoes = data.map((d, i, arr) => i != 0 ? d.building != arr[i - 1].building ? d.building : undefined : undefined);
    const manutencao = data.map((d, i, arr) => i != 0 ? d.maintenance != arr[i - 1].maintenance ? (d.maintenance - arr[i - 1].maintenance) * -1 : undefined : undefined);

    const diversos = data.map((d, i, arr) => i != 0 ? d.others != arr[i - 1].others ? d.others - arr[i - 1].others : undefined : undefined)
    const transferencias = data.map((d, i, arr) => i != 0 ? d.transfers != arr[i - 1].transfers ? d.transfers - arr[i - 1].transfers : undefined : undefined);

    const tickets = data.map((d, i, arr) => i != 0 ? d.tickets != arr[i - 1].tickets ? d.tickets - arr[i - 1].tickets : undefined : undefined)
    const patrocinios = data.map((d, i, arr) => i != 0 ? d.sponsor != arr[i - 1].sponsor ? d.sponsor - arr[i - 1].sponsor : undefined : undefined);
    
    const xAxisData = data.map(d => d.date);
    return {
        title: { text: 'Evolução das finanças' },
        tooltip: {
            trigger: 'axis',
            textStyle: {
                align: 'left'
            },
            position: function (pos, _, _, _, size) {
                var obj = { top: 10 };
                obj[['left', 'right'][+(pos[0] < (650))]] = 30;
                return obj;
            },
            extraCssText: 'width: 200px;',
            formatter: (params) => {
                const projection = params[0].dataIndex > data.length - projections.length - 1;
                if (params[0].axisIndex === 0) params.push(...params.splice(0, 2));

                const despesas = params.slice(0, 5);
                const tooltip = [];
                if (projection) tooltip.push(`<div style="font-size: 11px; font-weight: bold;">Projeção!<br/>(Baseado nas médias coletadas)</div>`);
                for (const param of despesas) {
                    if (param.data) tooltip.push(`${param.marker}${param.seriesName}: ${tooltipSpan(formatNumbers(param.data))}`);
                }
                const totalDespesas = despesas.reduce((a, b) => a + (isNaN(b.data) ? 0 : b.data), 0);
                tooltip.push(`${despesas.some(r => !isNaN(r.data)) ? '<hr size=1 style="margin: 3px 0">' : ''}${marker('red')}Total de despesas: ${tooltipSpan(formatNumbers(totalDespesas))}<br/>`);

                const receitas = params.slice(5, 9);
                for (const param of receitas) {
                    if (param.data) tooltip.push(`${param.marker}${param.seriesName}: ${tooltipSpan(formatNumbers(param.data))}`);
                }
                const totalReceitas = receitas.reduce((a, b) => a + (isNaN(b.data) ? 0 : b.data), 0);
                tooltip.push(`${receitas.some(r => !isNaN(r.data)) ? '<hr size=1 style="margin: 3px 0">' : ''}${marker('green')}Total de receitas: ${tooltipSpan(formatNumbers(totalReceitas))}<br/>`);

                tooltip.push(`${params[!projection ? 9 : 10].marker}${params[!projection ? 9 : 10].seriesName}: ${tooltipSpan(formatNumbers(params[!projection ? 9 : 10].data))}`);
                tooltip.push(`${totalReceitas === totalDespesas ? params[!projection ? 9 : 10].marker : totalReceitas - totalDespesas > 0 ? marker('green') : marker('red')}${!projection ? 'Variação' : 'Projeção'} do dia: ${tooltipSpan(formatNumbers(totalReceitas - totalDespesas))}`);
                return tooltip.join('<br/>');
            }
        },
        axisPointer: {
            type: 'cross',
            link: { xAxisIndex: 'all' }
        },
        legend: {
            bottom: 0, width: '100%',
        },
        grid: [
            {
                top: '7%',
                left: '10%',
                right: '1%',
                height: '20%'
            },
            {
                top: '32%',
                left: '10%',
                right: '1%',
                bottom: '10%',
                height: '46%'
            }
        ],
        xAxis: [
            {
                type: 'category',
                gridIndex: 0,
                axisLabel: { show: false },
                axisLine: { onZero: false },
                axisTick: { show: false },
                data: xAxisData,
                axisPointer: {
                    type: 'shadow',
                    label: {
                        show: true,
                        formatter: (params) => params.value.split('-').reverse().join('/')
                    }
                }
            },
            {
                type: 'category',
                gridIndex: 1,
                axisLabel: { show: false },
                data: xAxisData,
                axisLabel: {
                    formatter: (value, _) => value.split('-').reverse().join('/')
                },
                axisPointer: {
                    type: 'shadow'
                }
            }
        ],
        yAxis: [
            {
                type: 'value',
                min: 'dataMin', // Math.floor(d.reduce((acc, f) => f.current < acc ? f.current : acc, d[0].current) / 1000) * 1000,
                max: 'dataMax', // Math.ceil(d.reduce((acc, f) => f.current > acc ? f.current : acc, d[0].current) / 1000) * 1000,
                gridIndex: 0,
                splitArea: {
                    show: true
                },
                axisLabel: {
                    formatter: (value) => formatNumbers(value) + ' £'
                },
                axisPointer: {
                    type: 'line',
                    label: {
                        show: true
                    }
                }
            },
            {
                type: 'value',
                gridIndex: 1,
                axisLabel: {
                    formatter: (value) => formatNumbers(value) + ' £'
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
            xAxisIndex: [0, 1],
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
                yAxisIndex: 1, xAxisIndex: 1
            },
            {
                data: transferencias.map(v => v > 0 ? undefined : v * -1),
                type: 'bar',
                stack: 'Despesas',
                name: 'Compras',
                color: '#a4161a',
                yAxisIndex: 1, xAxisIndex: 1
            },
            {
                data: contrucoes,
                type: 'bar',
                stack: 'Despesas',
                name: 'Construções',
                color: '#ba181b',
                yAxisIndex: 1, xAxisIndex: 1
            },
            {
                data: manutencao,
                type: 'bar',
                stack: 'Despesas',
                name: 'Manutenção',
                color: '#e5383b',
                yAxisIndex: 1, xAxisIndex: 1
            },
            {
                data: diversos.map(v => v > 0 ? undefined : v * -1),
                type: 'bar',
                stack: 'Despesas',
                name: 'Outras despesas',
                color: '#EA5D5F',
                yAxisIndex: 1, xAxisIndex: 1
            },
            {
                data: patrocinios,
                type: 'bar',
                stack: 'Receitas',
                name: 'Patrocínios',
                color: '#143601',
                yAxisIndex: 1, xAxisIndex: 1
            },
            {
                data: transferencias.map(v => v > 0 ? v : undefined),
                type: 'bar',
                stack: 'Receitas',
                name: 'Vendas',
                color: '#245501',
                yAxisIndex: 1, xAxisIndex: 1
            },
            {
                data: tickets,
                type: 'bar',
                stack: 'Receitas',
                name: 'Bilheterias',
                color: '#538d22',
                yAxisIndex: 1, xAxisIndex: 1
            },
            {
                data: diversos.map(v => v > 0 ? v : undefined),
                type: 'bar',
                stack: 'Receitas',
                name: 'Outras receitas',
                color: '#73a942',
                yAxisIndex: 1, xAxisIndex: 1
            },
            {
                data: [...data.slice(0, data.length - projections.length + 1).map(d => d.current), ...projections.map(_ => undefined)],
                type: 'line',
                name: 'Saldo atual',
                color: '#5470c6'
            },
            {
                data: [...data.slice(0, data.length - projections.length).map(_ => undefined), ...projections.map(d => d.current)],
                type: 'line',
                name: 'Saldo previsto',
                color: 'orange'
            }
        ]
    };
}

const updateFinanceUI = async () => {
    const currentSeason = parseInt(document.querySelector('div.window_dialog_header').innerText.split(' ')[1]);
    /**
     * @type {Season[]}
     */
    const allSeasons = await seasons.toArray();
    const frame = document.querySelector('.window1_content_inside');

    const currentSeasonTab = frame.children[0];

    const ech = document.createElement('div');
    ech.id = `echarts-${currentSeason}`;
    ech.style.width = '910px';
    ech.style.height = '500px';

    currentSeasonTab.appendChild(ech);
    const correctedInfos = correctInfos(await finances.where({ season_id: currentSeason }).toArray());
    const predictions = await predictFinances(correctedInfos);
    echarts.init(ech).setOption(setupChart(correctedInfos, predictions.slice(1)));
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
            border: 1px solid black;
            width: 90px;
            border-radius: 5px 5px 0px 0px;
            text-align: center;
        `;
        seasonTab.innerHTML = `<a style="text-decoration: none;" href="#tab-${season.id}">Temporada ${season.id}</a>`;
        tabs.appendChild(seasonTab);

        const seasonContent = document.createElement('div');
        seasonContent.id = `tab-${season.id}`;

        if (season.id === currentSeason) seasonContent.appendChild(currentSeasonTab);
        else seasonContent.innerHTML = setupInfos(season.id, await finances.where({ season_id: season.id }).toArray());
        frame.appendChild(seasonContent);
    }
    $(frame).tabs();
}

const map = ['date', 'servertime', 'season_id', 'current', 'total_players_salary', 'total_coaches_salary', 'current_players_salary', 'current_coaches_salary', 'building', 'tickets', 'transfers', 'sponsor', 'prizes', 'maintenance', 'others'];
const dateEncoder = x => x.replace(':', '-').split('-').map(m => parseInt(m).toString(36)).join('-');
const numberEncoder = x => parseInt(x).toString(36);

const encodeFinances = async () =>
{
    const f = (await finances.where({ season_id: currentSeason }).toArray()).map(f => Object.entries(f).reduce((acc, [k, v]) =>
    {
        const i = map.indexOf(k);
        if (i >= 0) acc[i] = i > 1 ? numberEncoder(v) : dateEncoder(v);
        return acc;
    }, []));
    const encoded = JSON.stringify(f).replace(/\"/g, '').replace(/\],\[/g,'|').replace(/(\[\[|\]\])/g, '');
    console.log(`encoded in ${encoded.length} characters (${Math.round(encoded.length * 8 / 1024 * 1000) / 1000} KB)`);
    return encoded;
}

const decodeFinances = async () =>
{
    const response = await fetch("https://www.dugout-online.com/notebook/none", { method: "GET" });
    const dom = parser.parseFromString(await response.text(), 'text/html');
    const value = dom.querySelector('textarea.textfield[name="editedContents"]').value.split("DOFinanceTools\n=====")[1];
    if (!value) return;
    return value.split('|').map(line => line.split(',').map((v, i) => i > 1 ? parseInt(v, 36) : v.split('-').map(d => d === 'null' ? '00:00' : formatNumbers(parseInt(d, 36)).replace('.', '')).join(i === 0 ? '-' : ':')).reduce((acc, value, i) => ({ ...acc, [map[i]]: value }), {}));
}

const saveAtNotepad = async (notes) =>
{
    const response = await fetch("https://www.dugout-online.com/notebook/none", {
        "body": `savechanges=1&editedContents=${notes}`,
        method: "POST",
        mode: "cors",
        credentials: "include"
    });
}

(async function () {
    const decoded = await decodeFinances();
    // finances.bulkPut(decoded);
    switch (window.location.pathname) {
        case '/home/none/Free-online-football-manager-game':
            const response = await fetch("https://www.dugout-online.com/finances/none/", { method: 'GET' });
            const dom = parser.parseFromString(await response.text(), 'text/html');
            await crawlInfos(dom);
            await crawlMatches(currentSeason);
            await crawlTransfers()

            break;

        default:
            await crawlInfos(document);
            await crawlMatches(currentSeason);
            await crawlTransfers()

            await updateFinanceUI();
            break;
    }
    const encoded = await encodeFinances();
    // await saveAtNotepad(encoded);
})();