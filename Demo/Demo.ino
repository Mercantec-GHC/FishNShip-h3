#include <Arduino_PortentaMachineControl.h>
#include <Wire.h>

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
    Serial.println();

    delay(200);
}
