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

// One command jogs one direction for at most one second.
uint8_t direction = 0;
uint32_t changedAt = 0;
uint32_t lastReport = 0;

void stopConveyor()
{
    MachineControl_DigitalOutputs.write(0, LOW);
    MachineControl_DigitalOutputs.write(1, LOW);
    direction = 0;
    changedAt = millis();
}

void serviceConveyor()
{
    if (direction && millis() - changedAt >= 1000) stopConveyor();

    static char line[12];
    static size_t length = 0;
    for (int budget = 32; budget > 0 && Serial.available(); --budget)
    {
        const char c = Serial.read();
        if (c != '\n')
        {
            if (length < sizeof(line)) line[length++] = c;
            continue;
        }
        if (length < sizeof(line))
        {
            line[length] = 0;
            if (!strcmp(line, "BELT STOP")) stopConveyor();
            else if (!direction && millis() - changedAt >= 250)
            {
                const bool forward = !strcmp(line, "BELT Q1");
                if (forward || !strcmp(line, "BELT Q2"))
                {
                    direction = forward ? 1 : 2;
                    MachineControl_DigitalOutputs.write(direction - 1, HIGH);
                    changedAt = millis();
                }
            }
        }
        length = 0;
    }
}

void setup()
{
    Serial.begin(115200);

    Wire.begin();
    MachineControl_DigitalOutputs.begin();
    stopConveyor();
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
    serviceConveyor();
    if (millis() - lastReport < 200) return;
    lastReport = millis();
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
    Serial.print("  Q1=");
    Serial.print(direction == 1 ? 1 : 0);
    Serial.print("  Q2=");
    Serial.println(direction == 2 ? 1 : 0);
}
