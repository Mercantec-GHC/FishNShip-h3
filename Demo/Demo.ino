#include <Arduino_PortentaMachineControl.h>
#include <Wire.h>

void setup()
{
    Serial.begin(115200);

    Wire.begin();
    MachineControl_DigitalInputs.begin();

    Serial.println("Testing horizontal reference switch");
}

void loop()
{
    bool state = MachineControl_DigitalInputs.read(DIN_READ_CH_PIN_00);

    Serial.print("DI0 = ");
    Serial.println(state);

    delay(200);
}
