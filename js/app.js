// UI elements.
const deviceNameLabel = document.getElementById('device-name');
const connectButton = document.getElementById('connect-button');
const disconnectButton = document.getElementById('disconnect-button');
const terminalContainer = document.getElementById('terminal');
const sendForm = document.getElementById('send-form');
const inputField = document.getElementById('input');
const plotFileButton = document.getElementById('plotfile-button')

// Helpers.
const defaultDeviceName = 'Terminal';
const terminalAutoScrollingLimit = terminalContainer.offsetHeight / 2;
let isTerminalAutoScrolling = true;

const scrollElement = (element) => {
    const scrollTop = element.scrollHeight - element.offsetHeight;

    if (scrollTop > 0) {
        element.scrollTop = scrollTop;
    }
};

const logToTerminal = (message, type = '') => {
    terminalContainer.insertAdjacentHTML('beforeend',
        `<div${type && ` class='${type}'`}>${message}</div>`);

    if (isTerminalAutoScrolling) {
        scrollElement(terminalContainer);
    }
};

// Obtain configured instance.
const terminal = new BluetoothTerminal();

// Override `receive` method to log incoming data to the terminal.
terminal.receive = function (data) {
    logToTerminal(data, 'in');
};

// Override default log method to output messages to the terminal and console.
terminal._log = function (...messages) {
    // We can't use `super._log()` here.
    messages.forEach((message) => {
        logToTerminal(message);
        console.log(message); // eslint-disable-line no-console
    });
};

// Implement own send function to log outcoming data to the terminal.
const send = (data) => {
    terminal.send(data).
        then(() => logToTerminal(data, 'out')).
        catch((error) => logToTerminal(error));
};

// Bind event listeners to the UI elements.
connectButton.addEventListener('click', () => {
    console.log('clicked');
    terminal.connect().
        then(() => {
            deviceNameLabel.textContent = terminal.getDeviceName() ?
                terminal.getDeviceName() : defaultDeviceName;
        });
});

disconnectButton.addEventListener('click', () => {
    terminal.disconnect();
    deviceNameLabel.textContent = defaultDeviceName;
});

sendForm.addEventListener('submit', (event) => {
    event.preventDefault();

    send(inputField.value);

    inputField.value = '';
    inputField.focus();
});

// Switch terminal auto scrolling if it scrolls out of bottom.
terminalContainer.addEventListener('scroll', () => {
    const scrollTopOffset = terminalContainer.scrollHeight -
        terminalContainer.offsetHeight - terminalAutoScrollingLimit;

    isTerminalAutoScrolling = (scrollTopOffset < terminalContainer.scrollTop);
});

// --------------------------------------------------------------------------------------------------------

plotFileButton.addEventListener('click', () => {
    const selectedFile = document.getElementById('file-input').files[0];
    if (selectedFile) {
        let reader = new FileReader();

        reader.onload = function () {
            plotSamples(reader.result.split('\n'))
        };

        reader.onerror = function () {
            console.log(reader.error);
        };

        reader.readAsText(selectedFile);
    }
})

// --------------------------------------------------------------------------------------------------------

const LSB = 2.4 * 2 / 12.0 / (2 ** 24);

function transpose(a) {
    return Object.keys(a[0]).map(function (c) {
        return a.map(function (r) { return r[c]; });
    });
}

function decodeSample(sample) {
    if (sample.length === 55) {
        // Remove invisible trailing character
        sample = sample.slice(0, -1)
    }
    else if (sample.length > 55 || sample.length < 54) {
        return [null, null, null, null, null, null, null, null, null, null, null, null]
        //throw 'Invalid sample length'
    }

    var decodedVoltages = [];
    // Contains channel voltages as follows:
    // [C1, C2, C3, C4, C5, C6, C7, C8, LeadIII, aVR, aVL, aVF]

    for (var i = 0; i < 8; i++) {
        var code = sample.substr(6 + i * 6, 6); //SPLITS CODE INTO BITS OF 6
        var codeInt = parseInt(code, 16); //CONVERT TO INTEGER

        if (codeInt >= 8388608) {
            var volts = (codeInt - 2 ** 24) * LSB
        }
        else {
            var volts = codeInt * LSB; //MULTIPLY BY RANDOM CONSTANT TO GET VOLTAGE READING
        }

        if (Math.abs(volts) >= 0.001) {
            return [null, null, null, null, null, null, null, null, null, null, null, null]
        }

        decodedVoltages.push(volts * 10 ** 6); //ADD VOLTAGE READING TO LIST         
    }

    // LeadIII (C2 - C3)
    decodedVoltages.push(decodedVoltages[1] - decodedVoltages[2])

    // aVR (0 - (C2 - C3/2))
    decodedVoltages.push(0 - (decodedVoltages[1] - decodedVoltages[2]) / 2)

    // aVL (C2 - C3/2)
    decodedVoltages.push(decodedVoltages[1] - decodedVoltages[2] / 2)

    // aVF (C3 - C2/2)
    decodedVoltages.push(decodedVoltages[2] - decodedVoltages[1] / 2)

    return decodedVoltages
}

function generatePlotOptions(name, plotWidth) {
    return {
        title: name,
        id: name,
        class: "my-1",
        width: plotWidth,
        height: 200,
        series: [
            {},
            {
                show: true,
                spanGaps: false,
                label: name,
                value: (self, rawValue) => rawValue.toFixed(2) + ' uV',
                stroke: 'white',
                width: 1,
            }
        ],
        axes: [
            {
                show: true,
                stroke: 'white'
            },
            {
                show: true,
                label: 'Voltage (uV)',
                labelSize: 30,
                labelFont: 'bold 12px Arial',
                font: '12px Arial',
                gap: 5,
                size: 50,
                stroke: 'white',
                ticks: {
                    show: true,
                    stroke: '#eee',
                    width: 2,
                    dash: [],
                    size: 10,
                }
            }
        ],
        scales: {
            'x': {
                time: false,
            }
        },
    };
}

function plotSamples(samples) {
    var limbChartDiv = document.getElementById('limbCharts')
    var chestChartDiv = document.getElementById('chestCharts')

    var plotWidth = Math.max(limbChartDiv.offsetWidth, chestChartDiv.offsetWidth, 800)

    limbChartDiv.innerHTML = ''
    chestChartDiv.innerHTML = ''

    var decodedTimeSeries = transpose(samples.map(decodeSample));
    decodedTimeSeries.unshift([...Array(samples.length).keys()]);
    // This now contains:
    /*
    [
        [0, 1, 2, ..., n],                         <--- (the x-axis)
        [CHN1(0), CHN1(1), ..., CH1(n)],           <--- (channel 1 volts time series)
        [CHN2(0), CHN2(1), ..., CH1(n)],           <--- (channel 2 volts time series)
        [CHN3(0), CHN3(1), ..., CH1(n)],           <--- (channel 3 volts time series)
        [CHN4(0), CHN4(1), ..., CH1(n)],           <--- (channel 4 volts time series)
        [CHN5(0), CHN5(1), ..., CH1(n)],           <--- (channel 5 volts time series)
        [CHN6(0), CHN6(1), ..., CH1(n)],           <--- (channel 6 volts time series)
        [CHN7(0), CHN7(1), ..., CH1(n)],           <--- (channel 7 volts time series)
        [CHN8(0), CHN8(1), ..., CH1(n)],           <--- (channel 8 volts time series)
        [lIII(0), lIII(1), ..., CH1(n)],           <--- (Lead III volts time series)
        [aVR(0), aVR(1), ..., CH1(n)],           <--- (aVR volts time series)
        [aVL(0), aVL(1), ..., CH1(n)],           <--- (aVL volts time series)
        [aVF(0), aVF(1), ..., CH1(n)]            <--- (aVF volts time series)
    ]
    */

    chn1PlotData = [decodedTimeSeries[0], decodedTimeSeries[1]]
    chn2PlotData = [decodedTimeSeries[0], decodedTimeSeries[2]]
    chn3PlotData = [decodedTimeSeries[0], decodedTimeSeries[3]]
    chn4PlotData = [decodedTimeSeries[0], decodedTimeSeries[4]]
    chn5PlotData = [decodedTimeSeries[0], decodedTimeSeries[5]]
    chn6PlotData = [decodedTimeSeries[0], decodedTimeSeries[6]]
    chn7PlotData = [decodedTimeSeries[0], decodedTimeSeries[7]]
    chn8PlotData = [decodedTimeSeries[0], decodedTimeSeries[8]]
    lIIIPlotData = [decodedTimeSeries[0], decodedTimeSeries[9]]
    aVR_PlotData = [decodedTimeSeries[0], decodedTimeSeries[10]]
    aVL_PlotData = [decodedTimeSeries[0], decodedTimeSeries[11]]
    aVF_PlotData = [decodedTimeSeries[0], decodedTimeSeries[12]]

    let l1 = new uPlot(generatePlotOptions('LEAD_I', plotWidth), chn2PlotData, limbChartDiv);
    let l2 = new uPlot(generatePlotOptions('LEAD_II', plotWidth), chn3PlotData, limbChartDiv);
    let l3 = new uPlot(generatePlotOptions('LEAD_III', plotWidth), lIIIPlotData, limbChartDiv);
    let l4 = new uPlot(generatePlotOptions('aVR', plotWidth), aVR_PlotData, limbChartDiv);
    let l5 = new uPlot(generatePlotOptions('aVL', plotWidth), aVL_PlotData, limbChartDiv);
    let l6 = new uPlot(generatePlotOptions('aVF', plotWidth), aVF_PlotData, limbChartDiv);

    let c1 = new uPlot(generatePlotOptions('V1', plotWidth), chn8PlotData, chestChartDiv);
    let c2 = new uPlot(generatePlotOptions('V2', plotWidth), chn4PlotData, chestChartDiv);
    let c3 = new uPlot(generatePlotOptions('V3', plotWidth), chn5PlotData, chestChartDiv);
    let c4 = new uPlot(generatePlotOptions('V4', plotWidth), chn6PlotData, chestChartDiv);
    let c5 = new uPlot(generatePlotOptions('V5', plotWidth), chn7PlotData, chestChartDiv);
    let c6 = new uPlot(generatePlotOptions('V6', plotWidth), chn1PlotData, chestChartDiv);
}

// --------------------------------------------------------------------------------------------------------