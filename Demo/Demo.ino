#include <Arduino_PortentaMachineControl.h>
#include <Wire.h>

// Portenta Machine Control 0–10 V divider and 16-bit ADC scaling.
constexpr float voltsPerCount = 3.0f / 65535.0f / 0.28057f;
bool analogReady = false;

constexpr uint8_t digitalInputPins[] = {
    DIN_READ_CH_PIN_00,
    DIN_READ_CH_PIN_01,
    DIN_READ_CH_PIN_02,
    DIN_READ_CH_PIN_03,
    DIN_READ_CH_PIN_04,
    DIN_READ_CH_PIN_05,
    DIN_READ_CH_PIN_06,
    DIN_READ_CH_PIN_07,
};

void setup()
{
    Serial.begin(115200);

    Wire.begin();
    MachineControl_DigitalInputs.begin();
    analogReady = MachineControl_AnalogIn.begin(SensorType::V_0_10);
    if (!analogReady)
    {
        Serial.println("Analog input initialization failed");
    }

    Serial.println("Monitoring digital inputs DI0-DI7");
}

void loop()
{
    const uint32_t inputs = MachineControl_DigitalInputs.readAll();

    for (size_t channel = 0; channel < sizeof(digitalInputPins) / sizeof(digitalInputPins[0]); ++channel)
    {
        if (channel > 0)
        {
            Serial.print("  ");
        }

        const uint32_t state = (inputs >> digitalInputPins[channel]) & 1u;
        Serial.print("DI");
        Serial.print(channel);
        Serial.print('=');
        Serial.print(state);
    }
    if (analogReady)
    {
        uint16_t counts[3];
        for (int channel = 0; channel < 3; ++channel)
        {
            counts[channel] = MachineControl_AnalogIn.read(channel);
            Serial.print("  AI");
            Serial.print(channel);
            Serial.print('=');
            Serial.print(counts[channel] * voltsPerCount, 3);
        }
        for (int channel = 0; channel < 3; ++channel)
        {
            Serial.print("  ADC");
            Serial.print(channel);
            Serial.print('=');
            Serial.print(counts[channel]);
        }
    }
    Serial.println();

    delay(200);
}
