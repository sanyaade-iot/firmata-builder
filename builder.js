var fs = require('fs');

// import the list of all Firmata features
var allFeatures = require("./features.js");

var simulatedUserInput = {
    filename: "ConfiguredFirmata",
    connectionType: {
        serial: {
            baud: 57600
        }
    },
    selectedFeatures: [
        "DigitalInputFirmata",
        "DigitalOutputFirmata",
        "AnalogInputFirmata",
        "AnalogOutputFirmata",
        "ServoFirmata",
        "I2CFirmata",
        "OneWireFirmata",
        "StepperFirmata",
        "FirmataScheduler",
        "EncoderFirmata"
    ]
};

var filename = simulatedUserInput.filename;
var connectionType = simulatedUserInput.connectionType;

var outputText = "";

var featuresWithReporting = [];
var featuresWithUpdate = [];
var systemDependencies = Object.create(null);
var updateEnabled = false;
var reportingEnabled = false;

var analogInputEnabled = false;
var analogOutputEnabled = false;
var digitalInputEnabled = false;
var digitalOutputEnabled = false;
var servoEnabled = false;
var schedulerEnabled = false;

/**
 * Additional featurs should not be added to this function.
 * Ideally these comparisons will be eliminated at some point.
 */
function setEnabledFeatures(selectedFeature) {
    switch (selectedFeature) {
    case "AnalogInputFirmata":
        analogInputEnabled = true;
        break;
    case "AnalogOutputFirmata":
        analogOutputEnabled = true;
        break;
    case "DigitalInputFirmata":
        digitalInputEnabled = true;
        break;
    case "DigitalOutputFirmata":
        digitalOutputEnabled = true;
        break;
    case "ServoFirmata":
        servoEnabled = true;
        break;
    case "FirmataScheduler":
        schedulerEnabled = true;
        break;
    }
}

function processFeatureSelection(selectedFeatures) {
    var len = selectedFeatures.length;
    for (var i = 0; i < len; i++) {

        setEnabledFeatures(selectedFeatures[i]);

        var feature = allFeatures[selectedFeatures[i]];

        if (feature.reporting) {
            featuresWithReporting.push(feature);
        }
        if (feature.update) {
            featuresWithUpdate.push(feature)
        }

    }

    if (featuresWithReporting.length > 0) {
        reportingEnabled = true;
    }

    if (featuresWithUpdate.length > 0) {
        updateEnabled = true;
    }
}

function addHeader() {
    var date = new Date();
    var today = (date.getMonth() + 1) + "/" + date.getDate() + "/" + date.getFullYear();
    var header = "";

    header += "/*\n * " + filename + ".ino generated by FirmataBuilder\n";
    header += " * " + date.toString() + "\n */\n\n";

    header += "#include <Firmata.h>";
    header += "\n\n";
    return header;
}

function addIncludes(selectedFeatures) {
    var includes = "";

    for (var i = 0, len = selectedFeatures.length; i < len; i++) {
        var feature = allFeatures[selectedFeatures[i]];

        if (feature.systemDependencies) {
            for (var j = 0; j < feature.systemDependencies.length; j++) {
                d = feature.systemDependencies[j];
                // prevent duplicate includes
                if (!systemDependencies[d.className]) {
                    includes += "#include <" + d.path + d.className + ".h>\n";
                    systemDependencies[d.className] = true
                }
            }
        }

        includes += "#include <" + feature.path + feature.className + ".h>\n";
        includes += feature.className + " " + feature.instanceName + ";";
        includes += "\n\n";
    };

    // always include FirmataExt
    includes += "#include <utility/FirmataExt.h>\n";
    includes += "FirmataExt firmataExt;";
    includes += "\n\n";

    return includes;
}

/**
 * Dependencies that should be included after the initial set of included files.
 */
function addPostDependencies() {
    var includes = "";
    if (analogOutputEnabled || servoEnabled) {
        includes += "#include <utility/AnalogWrite.h>";
        includes += "\n\n";
    }
    if (reportingEnabled) {
        includes += "#include <utility/FirmataReporting.h>\n";
        includes += "FirmataReporting reporting;";
        includes += "\n\n";
    }
    return includes;
}

function addSystemResetCallbackFn() {
    var fn = "void systemResetCallback()\n";
    fn += "{\n";
    fn += "  for (byte i = 0; i < TOTAL_PINS; i++) {\n";
    fn += "    if (IS_PIN_ANALOG(i)) {\n";

    if (analogInputEnabled) {
        fn += "      Firmata.setPinMode(i, ANALOG);\n";
    }

    fn += "    } else if (IS_PIN_DIGITAL(i)) {\n";

    if (digitalOutputEnabled) {
        fn += "      Firmata.setPinMode(i, OUTPUT);\n";
    }

    fn += "    }\n";
    fn += "  }\n";

    fn += "  firmataExt.reset();\n";

    fn += "}\n\n";
    return fn;
}

function addSetupFn(selectedFeatures) {
    var fn = "void setup()\n";
    fn += "{\n";

    fn += "  Firmata.setFirmwareVersion(FIRMATA_MAJOR_VERSION, FIRMATA_MINOR_VERSION);\n\n";

    if (analogOutputEnabled || servoEnabled) {
        fn += "  Firmata.attach(ANALOG_MESSAGE, analogWriteCallback);\n\n";
    }

    for (var i = 0, len = selectedFeatures.length; i < len; i++) {
        var feature = allFeatures[selectedFeatures[i]];
        fn += "  firmataExt.addFeature(" + feature.instanceName + ");\n";
    }

    if (reportingEnabled) {
        fn += "  firmataExt.addFeature(reporting);\n\n";
    }

    fn += "  Firmata.attach(SYSTEM_RESET, systemResetCallback);\n\n";

    if (connectionType.serial) {
        fn += "  Firmata.begin(" + connectionType.serial.baud + ");\n\n";
    }

    fn += "  systemResetCallback();\n";

    fn += "}\n\n";
    return fn;
}

function addLoopFn() {
    var fn = "void loop()\n";
    fn += "{\n";

    if (digitalInputEnabled) {
        fn += "  digitalInput.report();\n\n";
    }

    fn += "  while(Firmata.available()) {\n";
    fn += "    Firmata.processInput();\n";

    if (schedulerEnabled) {
        fn += "    if (!Firmata.isParsingMessage()) {\n";
        fn += "      goto runtasks;\n";
        fn += "    }\n";
        fn += "  }\n"; // end while (if scheduler)
        fn += "  if (!Firmata.isParsingMessage()) {\n";
        fn += "runtasks: scheduler.runTasks();\n";
    }

    // if scheduler end if, else end while
    fn += "  }\n\n";

    if (reportingEnabled) {
        var numReporting = featuresWithReporting.length;
        fn += "  if (reporting.elapsed()) {\n";
        for (var i = 0; i < numReporting; i++) {
            fn += ("    " + featuresWithReporting[i].instanceName + ".report();\n");
        }
        fn += "  }\n\n";
    }

    if (updateEnabled) {
        var numUpdate = featuresWithUpdate.length
        for (var k = 0; k < numUpdate; k++) {
            fn += ("  " + featuresWithUpdate[k].instanceName + ".update();\n");
        }
    }

    fn += "}\n";
    return fn;
}

processFeatureSelection(simulatedUserInput.selectedFeatures);

outputText += addHeader();
outputText += addIncludes(simulatedUserInput.selectedFeatures);
outputText += addPostDependencies();
outputText += addSystemResetCallbackFn();
outputText += addSetupFn(simulatedUserInput.selectedFeatures);
outputText += addLoopFn();

fs.writeFileSync(filename + '.ino', outputText);
