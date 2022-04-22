// ==UserScript==
// @name         DOFinanceTools
// @version      0.1
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

const seasons_starts = {
    41: '2022-01-04'
}

const labels = [
    'Salário',
    'Compras',
    'Construções',
    'Manutenção',
    'Outras despesas',
    'Patrocínios',
    'Vendas',
    'Bilheterias',
    'Outras receitas'
];

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
db.version(1).stores({
    season: '&id',
    finance: '[season_id+date+current]'
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
 * @param {number} s
 * @returns {string}
 */
const formatNumbers = (s) => s === 0 ? '0' : formatter.format(s);

/**
 * 
 * @param {Document} dom 
 */
const crawlInfos = async (dom) => {
    const elements = [...dom.querySelectorAll('td')].map(el => el.innerText.trim()).filter(e => e);
    const save = elements.reduce((acc, _, index, arr) => {
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
    await seasons.put({ initial_balance: save.initial_balance, id: currentSeason });
    await finances.put({
        season_id: currentSeason,
        date: serverdate.toISOString().split('T')[0],
        current: save.current,
        ...save
    });
}

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

const marker = (color) => `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${color};"></span>`;
const tooltipSpan = (value) => `<span style="float: right; font-weight: bold;">${value} £</span>`;

/**
 * 
 * @param {Finance[]} d
 * @returns {EChartsOption}
 */
const setupChart = (d) => {
    const data = d.filter((f, i, arr) => {
        if (i === 0) return true;
        for (const key in f) {
            if (key === 'date') continue;
            const element = f[key];
            const prev = arr[i - 1][key];
            if (element !== prev) return true;
        }
        return false;
    });

    const salarios = data.map((d, i, arr) => i != 0 ? d.total_players_salary + d.total_coaches_salary != arr[i - 1].total_players_salary + arr[i - 1].total_coaches_salary ? (d.current_players_salary + d.current_coaches_salary) : undefined : undefined);
    const contrucoes = data.map((d, i, arr) => i != 0 ? d.building != arr[i - 1].building ? d.building : undefined : undefined);
    const manutencao = data.map((d, i, arr) => i != 0 ? d.maintenance != arr[i - 1].maintenance ? (d.maintenance - arr[i - 1].maintenance) * -1 : undefined : undefined);

    const diversos = data.map((d, i, arr) => i != 0 ? d.others != arr[i - 1].others ? d.others - arr[i - 1].others : undefined : undefined)
    const transferencias = data.map((d, i, arr) => i != 0 ? d.transfers != arr[i - 1].transfers ? d.transfers - arr[i - 1].transfers : undefined : undefined);

    const tickets = data.map((d, i, arr) => i != 0 ? d.tickets != arr[i - 1].tickets ? d.tickets - arr[i - 1].tickets : undefined : undefined)
    const patrocinios = data.map((d, i, arr) => i != 0 ? d.sponsor != arr[i - 1].sponsor ? d.sponsor - arr[i - 1].sponsor : undefined : undefined);
    return {
        title: { text: 'Evolução das finanças' },
        tooltip: {
            trigger: 'axis',
            textStyle: {
                align: 'left'
            },
            position: function (pos, params, el, elRect, size) {
                var obj = { top: 10 };
                obj[['left', 'right'][+(pos[0] < size.viewSize[0] / 2)]] = 30;
                return obj;
            },
            extraCssText: 'width: 200px;',
            formatter: (params) => {
                if (params[0].axisIndex === 0) params.push(...params.splice(0, 1));
                const despesas = params.slice(0, 5);
                const tooltip = [];
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

                tooltip.push(`${params[9].marker}${params[9].seriesName}: ${tooltipSpan(formatNumbers(params[9].data))}`);
                tooltip.push(`${totalReceitas === totalDespesas ? params[9].marker : totalReceitas - totalDespesas > 0 ? marker('green') : marker('red')}Variação do dia: ${tooltipSpan(formatNumbers(totalReceitas - totalDespesas))}`);
                return tooltip.join('<br/>');
            }
        },
        axisPointer: {
            type: 'cross',
            link: { xAxisIndex: 'all' }
        },
        legend: {
            bottom: 0
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
                data: data.map(d => d.date),
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
                data: data.map(d => d.date),
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
                min: Math.floor(d.reduce((acc, f) => f.current < acc ? f.current : acc, d[0].current) / 1000) * 1000,
                max: Math.ceil(d.reduce((acc, f) => f.current > acc ? f.current : acc, d[0].current) / 1000) * 1000,
                gridIndex: 0,
                splitArea: {
                    show: true
                },
                axisLabel: {
                    formatter: (value) => formatNumbers(value) + ' £'
                },
                axisPointer: {
                    label: {
                        show: true,
                        formatter: (params) => console.log(params) || formatNumbers(params.value)
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
                    label: {
                        show: true,
                        // formatter: (value) => formatNumbers(value)
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
                data: data.map(d => d.current),
                type: 'line',
                name: 'Saldo atual',
                color: '#5470c6'
            },
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
            }
        ]
    }
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
    echarts.init(ech).setOption(setupChart(await finances.where({ season_id: currentSeason }).toArray()));
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

(async function () {
    switch (window.location.pathname) {
        case '/home/none/Free-online-football-manager-game':
            const response = await fetch("https://www.dugout-online.com/finances/none/", { method: 'GET' });
            const dom = parser.parseFromString(await response.text(), 'text/html');
            await crawlInfos(dom);
            break;

        default:
            await crawlInfos(document);
            await updateFinanceUI();
            break;
    }
})();
