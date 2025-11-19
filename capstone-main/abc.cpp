#include <bits/stdc++.h>
using namespace std;

string encryptCaesarCipher(string message, int key) {
    string encryptedMessage = "";

    for (char c : message) {
        if (isalpha(c)) {
            char base = islower(c)?'a' : 'A';
            char shiftedChar =((c-base+key)%26)+base;
            encryptedMessage.push_back(shiftedChar);
        } else {
            encryptedMessage.push_back(c);
        }
    }
    return encryptedMessage;
}
int main() {
    string message;
    int key;
    cout << "Enter the message you want to encrypt: ";
    getline(cin, message);

    cout << "Enter the key value: ";
    cin >> key;

    string encryptedMessage = encryptCaesarCipher(message, key);
    cout << "Encrypted message: " << encryptedMessage << endl;
    return 0;
}
