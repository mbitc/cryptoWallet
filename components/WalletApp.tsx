/**
 * WalletApp.tsx - ETH piniginė
 * Naujos funkcijos:
 *   - Privataus rakto peržiūra (su PIN patvirtinimu)
 *   - Piniginės išvalymas (su PIN patvirtinimu + atkurimo frazės įspėjimas)
 */

import { ethers } from 'ethers';
import { Camera, CameraView } from 'expo-camera';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Clipboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import {
  decryptAndLoad,
  deleteWallet,
  encryptAndStore,
  walletExists,
} from '../src/crypto/walletCrypto';
import {
  NewWalletResult,
  createNewWallet,
  getBalance,
  isAddress,
  sendEth,
  walletFromPrivateKey,
} from '../src/services/walletService';

const C = {
  bg: '#0A0A0F',
  surface: '#12121A',
  border: '#1E1E2E',
  accent: '#6C63FF',
  accentDim: '#3D3875',
  text: '#E8E8F0',
  textMuted: '#6B6B8A',
  danger: '#FF4757',
  success: '#2ECC71',
  warning: '#F39C12',
};

const AUTO_LOCK_MS = 10 * 60 * 1000;
const BALANCE_INT_MS = 15 * 1000;

// ─── Mygtukas ─────────────────────────────────────────────────────────────────

const Btn = ({
  label,
  onPress,
  style,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  style?: any;
  disabled?: boolean;
  loading?: boolean;
}) => (
  <TouchableOpacity
    style={[styles.btn, disabled && styles.btnDisabled, style]}
    onPress={onPress}
    disabled={disabled || loading}
    activeOpacity={0.75}
  >
    {loading ? (
      <ActivityIndicator color={C.text} size='small' />
    ) : (
      <Text style={styles.btnLabel}>{label}</Text>
    )}
  </TouchableOpacity>
);

// ─── PIN ivestis ──────────────────────────────────────────────────────────────

const PinInput = ({
  value,
  onChange,
  label,
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoFocus?: boolean;
}) => {
  const inputRef = useRef<TextInput>(null);
  return (
    <TouchableOpacity
      style={styles.pinWrap}
      activeOpacity={1}
      onPress={() => inputRef.current?.focus()}
    >
      {!!label && <Text style={styles.fieldLabel}>{label}</Text>}
      <View style={styles.pinDots}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            style={[styles.pinDot, i < value.length && styles.pinDotFilled]}
          />
        ))}
      </View>
      <TextInput
        ref={inputRef}
        style={styles.pinRealInput}
        value={value}
        onChangeText={(v) => /^\d*$/.test(v) && v.length <= 6 && onChange(v)}
        keyboardType='number-pad'
        secureTextEntry={true}
        maxLength={6}
        autoFocus={autoFocus}
        caretHidden={true}
      />
    </TouchableOpacity>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SETUP SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

type SetupStep = 'generate' | 'mnemonic' | 'pin';

const SetupScreen = ({ onComplete }: { onComplete: () => void }) => {
  const [step, setStep] = useState<SetupStep>('generate');
  const [wallet, setWallet] = useState<NewWalletResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [pinStep, setPinStep] = useState<'first' | 'second'>('first');
  const [busy, setBusy] = useState(false);

  const handleGenerate = () => {
    const w = createNewWallet();
    setWallet(w);
    setStep('mnemonic');
  };

  const handlePinChange = (v: string) => {
    if (pinStep === 'first') {
      setPin(v);
      if (v.length === 6) setTimeout(() => setPinStep('second'), 200);
    } else {
      setPin2(v);
    }
  };

  const handleSavePin = async () => {
    if (pin !== pin2) {
      Alert.alert('Klaida', 'PIN kodai nesutampa.');
      setPin('');
      setPin2('');
      setPinStep('first');
      return;
    }
    if (!wallet) return;
    setBusy(true);
    try {
      await encryptAndStore(wallet.privateKey, pin);
      setWallet(null);
      setPin('');
      setPin2('');
      onComplete();
    } catch (e: any) {
      Alert.alert('Klaida', e.message ?? 'Nepavyko išsaugoti.');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'generate')
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.h1}>ETH piniginė</Text>
          <Text style={styles.sub}>tinklas ETH</Text>
          <View style={{ height: 48 }} />
          <Btn
            label='Sukurti naują piniginę'
            onPress={handleGenerate}
            style={styles.btnAccent}
          />
        </View>
      </SafeAreaView>
    );

  if (step === 'mnemonic' && wallet)
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.padded}>
          <Text style={styles.h2}>Atkurimo frazė</Text>
          <View style={styles.warningBox}>
            <Text style={styles.warningTxt}>
              Užsirašykite šiuos 12 žodžių popieriuje ir laikykite saugiai.
              {'\n'}
              Jei prarasite — piniginės atkurti bus NEĮMANOMA.{'\n'}
              Programa šios frazės daugiau NIEKADA nerodo.
            </Text>
          </View>
          <View style={styles.mnemonicGrid}>
            {wallet.mnemonic.split(' ').map((word, i) => (
              <View key={i} style={styles.mnemonicWord}>
                <Text style={styles.mnemonicIdx}>{i + 1}</Text>
                <Text style={styles.mnemonicTxt}>{word}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.checkRow, confirmed && styles.checkRowActive]}
            onPress={() => setConfirmed((v) => !v)}
            activeOpacity={0.8}
          >
            <View style={[styles.checkbox, confirmed && styles.checkboxFilled]}>
              {confirmed && <Text style={styles.checkmark}>V</Text>}
            </View>
            <Text style={styles.checkLabel}>
              Užsirašiau atkurimo frazę ir suprantu, kad jos praradimas reiškia
              amžiną lėšų praradimą.
            </Text>
          </TouchableOpacity>
          <Btn
            label='Tęsti'
            onPress={() => {
              if (!confirmed) {
                Alert.alert('Būtina patvirtinti', 'Pažymėkite žymėjimą.');
                return;
              }
              setStep('pin');
            }}
            style={[styles.btnAccent, { marginTop: 24 }]}
            disabled={!confirmed}
          />
        </ScrollView>
      </SafeAreaView>
    );

  if (step === 'pin')
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.h2}>
            {pinStep === 'first' ? 'Nustatykite PIN' : 'Pakartokite PIN'}
          </Text>
          <Text style={styles.sub}>
            {pinStep === 'first'
              ? '6 skaitmenų PIN saugos jūsų piniginę'
              : 'Įveskite PIN dar kartą'}
          </Text>
          <PinInput
            key={pinStep}
            value={pinStep === 'first' ? pin : pin2}
            onChange={handlePinChange}
            label=''
            autoFocus={true}
          />
          {pinStep === 'second' && pin2.length === 6 && (
            <Btn
              label='Išsaugoti'
              onPress={handleSavePin}
              style={[styles.btnAccent, { marginTop: 32 }]}
              loading={busy}
            />
          )}
          {pinStep === 'second' && (
            <TouchableOpacity
              style={{ marginTop: 16 }}
              onPress={() => {
                setPin('');
                setPin2('');
                setPinStep('first');
              }}
            >
              <Text style={{ color: C.textMuted, fontSize: 13 }}>
                Pradėti iš naujo
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );

  return null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. PIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

const PinScreen = ({ onUnlock }: { onUnlock: (w: ethers.Wallet) => void }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (pin.length === 6) handleUnlock(pin);
  }, [pin]);

  const handleUnlock = async (p: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const pk = await decryptAndLoad(p);
      const w = walletFromPrivateKey(pk);
      if (mounted.current) onUnlock(w);
    } catch (e: any) {
      if (!mounted.current) return;
      setPin('');
      const next = attempts + 1;
      setAttempts(next);
      setError(
        e.message === 'WRONG_PIN'
          ? next >= 10
            ? 'Per daug bandymų.'
            : 'Neteisingas PIN. Bandymas ' + next + '/10.'
          : 'Klaida: ' + (e.message ?? 'nežinoma'),
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.center}>
        <Text style={styles.h2}>Įveskite PIN</Text>
        <Text style={styles.sub}>Piniginė užrakinta</Text>
        {busy ? (
          <ActivityIndicator
            color={C.accent}
            size='large'
            style={{ marginTop: 40 }}
          />
        ) : (
          <PinInput value={pin} onChange={setPin} label='' autoFocus={true} />
        )}
        {!!error && <Text style={styles.errorTxt}>{error}</Text>}
      </View>
    </SafeAreaView>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. WALLET SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

type Tab = 'home' | 'send' | 'receive' | 'scan';
type ModalType = 'none' | 'pk' | 'reset';

const WalletScreen = ({
  wallet,
  address,
  onLock,
  onReset,
}: {
  wallet: ethers.Wallet;
  address: string;
  onLock: () => void;
  onReset: () => void;
}) => {
  const [balance, setBalance] = useState('...');
  const [tab, setTab] = useState<Tab>('home');
  const [toAddr, setToAddr] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [sendErr, setSendErr] = useState('');
  const [camPerm, setCamPerm] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [modal, setModal] = useState<ModalType>('none');
  const [modalPin, setModalPin] = useState('');
  const [modalErr, setModalErr] = useState('');
  const [modalBusy, setModalBusy] = useState(false);
  const [shownPk, setShownPk] = useState('');

  const mounted = useRef(true);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  const resetLockTimer = useCallback(() => {
    if (lockTimer.current) clearTimeout(lockTimer.current);
    lockTimer.current = setTimeout(onLock, AUTO_LOCK_MS);
  }, [onLock]);

  const refreshBalance = useCallback(async () => {
    try {
      const b = await getBalance(address);
      if (mounted.current) setBalance(parseFloat(b).toFixed(6));
    } catch {
      if (mounted.current) setBalance('klaida');
    }
  }, [address]);

  useEffect(() => {
    refreshBalance();
    const interval = setInterval(refreshBalance, BALANCE_INT_MS);
    resetLockTimer();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        refreshBalance();
        resetLockTimer();
      }
    });
    return () => {
      clearInterval(interval);
      if (lockTimer.current) clearTimeout(lockTimer.current);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (tab === 'scan') {
      Camera.requestCameraPermissionsAsync().then(({ status }) => {
        if (mounted.current) {
          setCamPerm(status === 'granted');
          setScanned(false);
        }
      });
    }
  }, [tab]);

  const openModal = (type: ModalType) => {
    setModal(type);
    setModalPin('');
    setModalErr('');
    setShownPk('');
    resetLockTimer();
  };

  const closeModal = () => {
    setModal('none');
    setModalPin('');
    setModalErr('');
    setShownPk('');
  };

  // ── Privataus rakto rodymas ───────────────────────────────────────────────────
  const handleShowPk = async () => {
    if (modalPin.length !== 6 || modalBusy) return;
    setModalBusy(true);
    setModalErr('');
    try {
      const pk = await decryptAndLoad(modalPin);
      if (mounted.current) {
        setShownPk(pk);
        setModalPin('');
      }
    } catch (e: any) {
      if (mounted.current) {
        setModalErr(e.message === 'WRONG_PIN' ? 'Neteisingas PIN.' : 'Klaida.');
        setModalPin('');
      }
    } finally {
      if (mounted.current) setModalBusy(false);
    }
    resetLockTimer();
  };

  // ── Piniginės išvalymas ──────────────────────────────────────────────────
  const handleReset = async () => {
    if (modalPin.length !== 6 || modalBusy) return;
    setModalBusy(true);
    setModalErr('');
    try {
      await decryptAndLoad(modalPin);
      await deleteWallet();
      if (mounted.current) onReset();
    } catch (e: any) {
      if (mounted.current) {
        setModalErr(e.message === 'WRONG_PIN' ? 'Neteisingas PIN.' : 'Klaida.');
        setModalPin('');
      }
    } finally {
      if (mounted.current) setModalBusy(false);
    }
  };

  // ── Siuntimas ─────────────────────────────────────────────────────────────
  const handleSend = async () => {
    setSendErr('');
    setTxHash('');
    if (!isAddress(toAddr)) {
      setSendErr('Neteisingas adresas.');
      return;
    }
    if (!amount || isNaN(+amount) || +amount <= 0) {
      setSendErr('Neteisingas kiekis.');
      return;
    }
    setSending(true);
    try {
      const { txHash: h } = await sendEth(wallet, toAddr, amount);
      if (mounted.current) {
        setTxHash(h);
        setToAddr('');
        setAmount('');
        refreshBalance();
      }
    } catch (e: any) {
      if (mounted.current) setSendErr(e?.message ?? 'Siuntimo klaida.');
    } finally {
      if (mounted.current) setSending(false);
    }
    resetLockTimer();
  };

  const handleQRScan = ({ data }: { type: string; data: string }) => {
    if (scanned) return;
    setScanned(true);
    const addr = data.replace(/^ethereum:/i, '').split('?')[0];
    if (isAddress(addr)) {
      setToAddr(addr);
      setTab('send');
    } else {
      Alert.alert('Netinkamas QR', 'Nepavyko atpažinti adreso.');
      setScanned(false);
    }
  };

  // ── Modalas ───────────────────────────────────────────────────────────────
  const renderModal = () => {
    if (modal === 'none') return null;
    const isPk = modal === 'pk';
    return (
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <Text style={styles.modalTitle}>
            {isPk ? 'Privatus raktas' : 'Išvalyti piniginę'}
          </Text>

          {isPk && !!shownPk ? (
            // Rodomas privatus raktas
            <>
              <View style={styles.warningBox}>
                <Text style={styles.warningTxt}>
                  Niekada nesidalinkite šiuo raktu. Kas turės šį raktą — valdys
                  jūsų lėšas.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.pkBox}
                onPress={() => {
                  Clipboard.setString(shownPk);
                  Alert.alert('Nukopijuota', 'Privatus raktas nukopijuotas.');
                }}
              >
                <Text style={styles.pkTxt}>{shownPk}</Text>
                <Text
                  style={[styles.fieldLabel, { color: C.accent, marginTop: 8 }]}
                >
                  nukopijuoti
                </Text>
              </TouchableOpacity>
              <Btn
                label='Uždaryti'
                onPress={closeModal}
                style={[styles.btnAccent, { marginTop: 16 }]}
              />
            </>
          ) : (
            // PIN ivedimas
            <>
              {!isPk && (
                <View style={styles.warningBox}>
                  <Text style={styles.warningTxt}>
                    Šis veiksmas neatstatomas. Įsitikinkite, kad turite atkurimo
                    frazę.{'\n'}
                    Visi duomenys bus ištrinti.
                  </Text>
                </View>
              )}
              <Text style={styles.modalSub}>Patvirtinkite PIN</Text>
              <PinInput
                key={modal}
                value={modalPin}
                onChange={(v) => {
                  setModalPin(v);
                  setModalErr('');
                }}
                label=''
                autoFocus={true}
              />
              {!!modalErr && <Text style={styles.errorTxt}>{modalErr}</Text>}
              <View style={styles.modalBtns}>
                <Btn
                  label='Atgal'
                  onPress={closeModal}
                  style={{ flex: 1, marginRight: 8 }}
                />
                <Btn
                  label={isPk ? 'Rodyti' : 'Išvalyti'}
                  onPress={isPk ? handleShowPk : handleReset}
                  style={[
                    { flex: 1 },
                    isPk
                      ? styles.btnAccent
                      : {
                          backgroundColor: C.danger,
                          borderColor: C.danger,
                          borderWidth: 1,
                          borderRadius: 12,
                        },
                  ]}
                  loading={modalBusy}
                  disabled={modalPin.length !== 6}
                />
              </View>
            </>
          )}
        </View>
      </View>
    );
  };

  const tabs = [
    { id: 'home' as Tab, label: 'Namai' },
    { id: 'receive' as Tab, label: 'Gauti' },
    { id: 'send' as Tab, label: 'Siųsti' },
    { id: 'scan' as Tab, label: 'Skaityti' },
  ];

  const renderContent = () => {
    switch (tab) {
      case 'home':
        return (
          <ScrollView contentContainerStyle={styles.homeTab}>
            <Text style={styles.networkBadge}> ETH mainnet</Text>
            <Text style={styles.balanceLabel}>BALANSAS</Text>
            <Text style={styles.balanceAmt}>{balance}</Text>
            <Text style={styles.balanceCur}>ETH</Text>

            <TouchableOpacity
              style={styles.addrBox}
              onPress={() => {
                Clipboard.setString(address);
                Alert.alert('Nukopijuota', 'Adresas nukopijuotas.');
              }}
            >
              <Text style={styles.addrTxt}>
                {address.slice(0, 8)}...{address.slice(-6)}
              </Text>
              <Text style={styles.addrCopy}>nukopijuoti</Text>
            </TouchableOpacity>

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => openModal('pk')}
              >
                <Text style={styles.actionLabel}>Privatus raktas</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnDanger]}
                onPress={() => openModal('reset')}
              >
                <Text style={[styles.actionLabel, { color: C.danger }]}>
                  Išvalyti
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.lockBtn} onPress={onLock}>
              <Text style={styles.lockBtnTxt}>Užrakinti</Text>
            </TouchableOpacity>
          </ScrollView>
        );

      case 'receive':
        return (
          <View style={styles.receiveTab}>
            <Text style={styles.tabTitle}>Gauti ETH</Text>
            <View style={styles.qrWrap}>
              <QRCode
                value={address}
                size={220}
                color={C.text}
                backgroundColor={C.surface}
              />
            </View>
            <TouchableOpacity
              style={styles.addrBox}
              onPress={() => {
                Clipboard.setString(address);
                Alert.alert('Nukopijuota', 'Adresas nukopijuotas.');
              }}
            >
              <Text style={[styles.addrTxt, { fontSize: 11 }]}>{address}</Text>
              <Text style={styles.addrCopy}>nukopijuoti</Text>
            </TouchableOpacity>
            <Text style={styles.notice}>ETH mainnet</Text>
          </View>
        );

      case 'send':
        return (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
          >
            <ScrollView contentContainerStyle={styles.sendTab}>
              <Text style={styles.tabTitle}>Siųsti ETH</Text>
              <Text style={styles.fieldLabel}>Gavėjo adresas</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={toAddr}
                  onChangeText={(v) => {
                    setToAddr(v);
                    resetLockTimer();
                  }}
                  placeholder='0x...'
                  placeholderTextColor={C.textMuted}
                  autoCapitalize='none'
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.scanInlineBtn}
                  onPress={() => {
                    setTab('scan');
                    resetLockTimer();
                  }}
                >
                  <Text style={{ color: C.accent, fontSize: 16 }}>QR</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>
                Kiekis (ETH)
              </Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={(v) => {
                  setAmount(v);
                  resetLockTimer();
                }}
                placeholder='0.001'
                placeholderTextColor={C.textMuted}
                keyboardType='decimal-pad'
              />
              <Text style={styles.balanceHint}>Balansas: {balance} ETH</Text>
              {!!sendErr && <Text style={styles.errorTxt}>{sendErr}</Text>}
              {!!txHash && (
                <TouchableOpacity
                  onPress={() => {
                    Clipboard.setString(txHash);
                    Alert.alert('Nukopijuota', 'TX hash nukopijuotas.');
                  }}
                >
                  <Text style={styles.successTxt}>
                    Išsiųsta!{'\n'}
                    <Text style={{ fontSize: 11, color: C.textMuted }}>
                      {txHash.slice(0, 12)}...{txHash.slice(-8)}
                    </Text>
                  </Text>
                </TouchableOpacity>
              )}
              <Btn
                label='Siųsti'
                onPress={handleSend}
                style={[styles.btnAccent, { marginTop: 24 }]}
                loading={sending}
                disabled={!toAddr || !amount}
              />
            </ScrollView>
          </KeyboardAvoidingView>
        );

      case 'scan':
        return (
          <View style={{ flex: 1 }}>
            <Text style={[styles.tabTitle, { padding: 20 }]}>Skenuoti QR</Text>
            {!camPerm ? (
              <View style={styles.center}>
                <Text style={styles.textMuted}>Kamera neprieinama.</Text>
                <Btn
                  label='Suteikti leidimą'
                  onPress={() =>
                    Camera.requestCameraPermissionsAsync().then(
                      ({ status }) => {
                        if (mounted.current) setCamPerm(status === 'granted');
                      },
                    )
                  }
                  style={[styles.btnAccent, { marginTop: 16 }]}
                />
              </View>
            ) : (
              <CameraView
                style={{ flex: 1 }}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={scanned ? undefined : handleQRScan}
              >
                <View style={styles.scanOverlay}>
                  <View style={styles.scanFrame} />
                  <Text style={styles.scanHint}>
                    Nukreipkite į Ethereum QR kodą
                  </Text>
                </View>
              </CameraView>
            )}
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={{ flex: 1 }}>
        {renderContent()}
        {renderModal()}
      </View>
      <View style={styles.tabBar}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={styles.tabItem}
            onPress={() => {
              setTab(t.id);
              resetLockTimer();
            }}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.tabLabel, tab === t.id && styles.tabLabelActive]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════════════════

type AppState_ = 'loading' | 'setup' | 'pin' | 'wallet';

export default function WalletApp() {
  const [appState, setAppState] = useState<AppState_>('loading');
  const [wallet, setWallet] = useState<ethers.Wallet | null>(null);
  const [address, setAddress] = useState('');

  useEffect(() => {
    walletExists()
      .then((exists) => setAppState(exists ? 'pin' : 'setup'))
      .catch(() => setAppState('setup'));
  }, []);

  const content = () => {
    if (appState === 'loading')
      return (
        <SafeAreaView style={styles.screen}>
          <View style={styles.center}>
            <ActivityIndicator color={C.accent} size='large' />
          </View>
        </SafeAreaView>
      );
    if (appState === 'setup')
      return <SetupScreen onComplete={() => setAppState('pin')} />;
    if (appState === 'pin')
      return (
        <PinScreen
          onUnlock={(w) => {
            setWallet(w);
            setAddress(w.address);
            setAppState('wallet');
          }}
        />
      );
    if (appState === 'wallet' && wallet)
      return (
        <WalletScreen
          wallet={wallet}
          address={address}
          onLock={() => {
            setWallet(null);
            setAppState('pin');
          }}
          onReset={() => {
            setWallet(null);
            setAddress('');
            setAppState('setup');
          }}
        />
      );
    return null;
  };

  return <SafeAreaProvider>{content()}</SafeAreaProvider>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STILIAI
// ═══════════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  padded: { padding: 24, paddingBottom: 48 },

  h1: {
    fontSize: 28,
    fontWeight: '700',
    color: C.text,
    letterSpacing: 1,
    marginBottom: 8,
  },
  h2: { fontSize: 22, fontWeight: '700', color: C.text, marginBottom: 8 },
  sub: {
    fontSize: 14,
    color: C.textMuted,
    marginBottom: 4,
    textAlign: 'center',
  },
  textMuted: { color: C.textMuted, fontSize: 14 },
  notice: {
    color: C.textMuted,
    fontSize: 12,
    marginTop: 16,
    textAlign: 'center',
  },

  warningBox: {
    backgroundColor: '#1A1500',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#3A3000',
  },
  warningTxt: { color: C.warning, fontSize: 13, lineHeight: 20 },

  errorTxt: {
    color: C.danger,
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  successTxt: {
    color: C.success,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },

  btn: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  btnAccent: { backgroundColor: C.accent, borderColor: C.accent },
  btnDisabled: { opacity: 0.45 },
  btnLabel: { color: C.text, fontWeight: '600', fontSize: 16 },

  pinWrap: { alignItems: 'center', marginTop: 32, width: '100%' },
  fieldLabel: { color: C.textMuted, fontSize: 12, marginBottom: 8 },
  pinDots: { flexDirection: 'row', gap: 14, marginBottom: 4 },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: C.border,
    backgroundColor: 'transparent',
  },
  pinDotFilled: { backgroundColor: C.accent, borderColor: C.accent },
  pinRealInput: {
    color: 'transparent',
    backgroundColor: 'transparent',
    width: '100%',
    height: 44,
    textAlign: 'center',
    fontSize: 24,
  },

  input: {
    backgroundColor: C.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    color: C.text,
    padding: 14,
    fontSize: 15,
    width: '100%',
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scanInlineBtn: {
    backgroundColor: C.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  mnemonicGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 20,
  },
  mnemonicWord: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.bg,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 6,
    width: '30%',
  },
  mnemonicIdx: { color: C.textMuted, fontSize: 10, width: 14 },
  mnemonicTxt: { color: C.text, fontSize: 13, fontWeight: '500' },

  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  checkRowActive: { borderColor: C.accent },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxFilled: { backgroundColor: C.accent, borderColor: C.accent },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  checkLabel: { color: C.textMuted, fontSize: 13, lineHeight: 19, flex: 1 },

  homeTab: {
    alignItems: 'center',
    padding: 32,
    paddingTop: 48,
    paddingBottom: 48,
  },
  networkBadge: {
    color: C.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    backgroundColor: C.accentDim + '44',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 20,
    marginBottom: 40,
  },
  balanceLabel: {
    color: C.textMuted,
    fontSize: 12,
    letterSpacing: 2,
    marginBottom: 8,
  },
  balanceAmt: {
    color: C.text,
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: -1,
  },
  balanceCur: {
    color: C.textMuted,
    fontSize: 18,
    marginTop: 4,
    marginBottom: 32,
  },
  addrBox: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
    width: '100%',
  },
  addrTxt: {
    color: C.textMuted,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  addrCopy: { color: C.accent, fontSize: 11, marginTop: 4 },
  lockBtn: { marginTop: 32, padding: 12 },
  lockBtnTxt: { color: C.textMuted, fontSize: 14 },
  balanceHint: { color: C.textMuted, fontSize: 12, marginTop: 6 },

  actionRow: { flexDirection: 'row', gap: 12, marginTop: 20, width: '100%' },
  actionBtn: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    paddingVertical: 16,
  },
  actionBtnDanger: { borderColor: '#FF475766' },
  actionLabel: { color: C.textMuted, fontSize: 13, fontWeight: '600' },

  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000DD',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    padding: 16,
  },
  modalBox: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: C.border,
  },
  modalTitle: {
    color: C.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSub: { color: C.textMuted, fontSize: 13, textAlign: 'center' },
  modalBtns: { flexDirection: 'row', marginTop: 20 },
  pkBox: {
    backgroundColor: C.bg,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginTop: 8,
    alignItems: 'center',
  },
  pkTxt: {
    color: C.text,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    lineHeight: 18,
  },

  receiveTab: { flex: 1, alignItems: 'center', padding: 24 },
  tabTitle: {
    color: C.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 24,
  },
  qrWrap: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 20,
  },

  sendTab: { padding: 24, paddingBottom: 48 },

  scanOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanFrame: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: C.accent,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  scanHint: { color: C.text, marginTop: 24, fontSize: 14 },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    paddingTop: 10,
  },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  tabLabel: { fontSize: 12, color: C.textMuted },
  tabLabelActive: { color: C.accent, fontWeight: '600' },
});
