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

void stopMotors()
{
    MachineControl_DigitalOutputs.writeAll(0);
    direction = 0;
    changedAt = millis();
}

void serviceMotors()
{
    if (direction && millis() - changedAt >= 1000) stopMotors();

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
            if (!strcmp(line, "MOTOR STOP") || !strcmp(line, "BELT STOP")) stopMotors();
            else if (!direction && millis() - changedAt >= 250)
            {
                uint8_t output = 0;
                if (length == 8 && !strncmp(line, "MOTOR Q", 7) && line[7] >= '1' && line[7] <= '8')
                    output = line[7] - '0';
                else if (!strcmp(line, "BELT Q1")) output = 1;
                else if (!strcmp(line, "BELT Q2")) output = 2;
                if (output)
                {
                    direction = output;
                    MachineControl_DigitalOutputs.writeAll(1u << (output - 1));
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
    stopMotors();
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
    serviceMotors();
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
    for (uint8_t output = 1; output <= 8; ++output)
    {
        Serial.print("  Q");
        Serial.print(output);
        Serial.print('=');
        Serial.print(direction == output ? 1 : 0);
    }
    Serial.println();
}
