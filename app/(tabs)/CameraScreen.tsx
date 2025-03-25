import React, { useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Animated } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ScreenOrientation from "expo-screen-orientation";
import { Audio } from "expo-av";
import { useNavigation } from "@react-navigation/native";

export default function CameraScreen() {
    const navigation = useNavigation();
    const [permission, requestPermission] = useCameraPermissions();
    const [sound, setSound] = useState<Audio.Sound | null>(null);
    const [cameraFacing, setCameraFacing] = useState<"front" | "back">("back");
    const [countdown, setCountdown] = useState<number | null>(null);
    const [isActive, setIsActive] = useState<boolean>(false);
    const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const randomStopTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const fadeAnim = new Animated.Value(1);
    const scaleAnim = new Animated.Value(1);

    useEffect(() => {
        const lockOrientation = async () => {
            await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        };
        lockOrientation();

        return () => {
            ScreenOrientation.unlockAsync();
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
            }
            if (randomStopTimeoutRef.current) {
                clearTimeout(randomStopTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!permission?.granted) {
            requestPermission();
        }
    }, [permission]);

    useEffect(() => {
        async function requestAudioPermissions() {
            const { status } = await Audio.requestPermissionsAsync();
            if (status !== "granted") {
                console.log("Audio permission denied");
            } else {
                console.log("Audio permission granted");
            }
        }
        requestAudioPermissions();
    }, []);

    async function playSound() {
        try {
            console.log("Attempting to play sound...");
            await Audio.setAudioModeAsync({
                playsInSilentModeIOS: true,
                allowsRecordingIOS: false,
                staysActiveInBackground: true,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false,
            });

            if (sound) {
                // Resume the existing sound (which was paused) so it continues from its current position.
                console.log("Resuming sound...");
                await sound.playAsync();
            } else {
                const { sound: newSound } = await Audio.Sound.createAsync(
                    require("../../assets/song.mp3"),
                    { shouldPlay: true }
                );
                setSound(newSound);
                console.log("Playing new sound...");
            }

            // Schedule a random stop between 15 to 30 seconds.
            const randomDelay = Math.floor(Math.random() * 15000) + 15000; // 15000ms to 30000ms
            randomStopTimeoutRef.current = setTimeout(randomStop, randomDelay);
        } catch (error) {
            console.error("Error playing sound:", error);
        }
    }

    // This function pauses the music and starts the 10-second settle countdown.
    async function randomStop() {
        console.log("Random stop triggered");
        if (sound) {
            // Pause instead of stopping so we can resume from the same position.
            await sound.pauseAsync();
        }
        if (randomStopTimeoutRef.current) {
            clearTimeout(randomStopTimeoutRef.current);
            randomStopTimeoutRef.current = null;
        }
        startSettleCountdown();
    }

    // Start a 10-second countdown for players to settle and remove a chair.
    // The song is already paused when this countdown starts.
    function startSettleCountdown() {
        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
        }
        setCountdown(10);
        let count = 10;
        countdownIntervalRef.current = setInterval(() => {
            count -= 1;
            if (count < 0) {
                clearInterval(countdownIntervalRef.current as NodeJS.Timeout);
                countdownIntervalRef.current = null;
                setCountdown(null);
                // Resume playing the sound from where it was paused.
                playSound();
            } else {
                setCountdown(count);
                animateCountdown();
            }
        }, 1000);
    }

    useEffect(() => {
        return sound
            ? () => {
                console.log("Unloading sound...");
                sound.unloadAsync();
            }
            : undefined;
    }, [sound]);

    const toggleCamera = () => {
        setCameraFacing((prev) => (prev === "back" ? "front" : "back"));
    };

    const handleStartCancel = () => {
        if (isActive) {
            // Cancel the current countdown or settle process.
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
            if (randomStopTimeoutRef.current) {
                clearTimeout(randomStopTimeoutRef.current);
                randomStopTimeoutRef.current = null;
            }
            setCountdown(null);
            if (sound) {
                // Stop and unload the sound if the game is cancelled.
                sound.stopAsync();
                sound.unloadAsync();
                setSound(null);
            }
            setIsActive(false);
        } else {
            // Start the initial 5-second countdown before playing sound.
            setIsActive(true);
            setCountdown(5);
            let count = 5;
            countdownIntervalRef.current = setInterval(() => {
                count -= 1;
                if (count < 0) {
                    clearInterval(countdownIntervalRef.current as NodeJS.Timeout);
                    countdownIntervalRef.current = null;
                    setCountdown(null);
                    playSound();
                } else {
                    setCountdown(count);
                    animateCountdown();
                }
            }, 1000);
        }
    };

    const animateCountdown = () => {
        fadeAnim.setValue(1);
        scaleAnim.setValue(1);
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 900,
                useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
                toValue: 2,
                duration: 900,
                useNativeDriver: true,
            }),
        ]).start();
    };

    if (!permission) {
        return (
            <View>
                <Text>Requesting camera permission...</Text>
            </View>
        );
    }

    if (!permission.granted) {
        return (
            <View style={styles.permissionContainer}>
                <Text>No access to camera</Text>
                <Text>Please grant camera permission in settings.</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <CameraView
                style={styles.camera}
                facing={cameraFacing}
                videoStabilizationMode="auto"
            />

            {/* Back Button */}
            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
                <Text style={styles.backButtonText}>BACK</Text>
            </TouchableOpacity>

            {/* Countdown Display */}
            {countdown !== null && (
                <View style={styles.countdownContainer}>
                    <Animated.Text
                        style={[
                            styles.countdownText,
                            { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
                        ]}
                    >
                        {countdown}
                    </Animated.Text>
                </View>
            )}

            {/* Start/Cancel Button */}
            <TouchableOpacity
                style={[
                    styles.startButton,
                    isActive ? { backgroundColor: "rgba(255, 0, 0, 0.3)" } : {},
                ]}
                onPress={handleStartCancel}
            >
                <Text style={styles.buttonText}>{isActive ? "Cancel" : "START"}</Text>
            </TouchableOpacity>

            {/* Camera Toggle Button */}
            <TouchableOpacity style={styles.toggleButton} onPress={toggleCamera}>
                <Text style={styles.buttonText}>SWITCH</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    camera: {
        flex: 1,
        width: "100%",
    },
    permissionContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    backButton: {
        position: "absolute",
        top: 40,
        left: 20,
        backgroundColor: "rgba(255, 192, 74, 0.5)",
        borderWidth: 2,
        borderColor: "white",
        paddingVertical: 20,
        paddingHorizontal: 25,
        borderRadius: 40,
    },
    backButtonText: {
        color: "white",
        fontSize: 22,
        fontWeight: "bold",
    },
    startButton: {
        position: "absolute",
        bottom: 130,
        right: 30,
        backgroundColor: "rgba(115, 255, 148, 0.3)",
        padding: 20,
        borderRadius: 70,
        borderWidth: 2,
        borderColor: "white",
        justifyContent: "center",
        alignItems: "center",
        width: 120,
        height: 120,
    },
    toggleButton: {
        position: "absolute",
        bottom: 30,
        right: 40,
        backgroundColor: "rgba(100, 177, 255, 0.3)",
        padding: 15,
        borderRadius: 30,
        borderWidth: 2,
        borderColor: "white",
        justifyContent: "center",
        alignItems: "center",
        width: 80,
        height: 80,
    },
    buttonText: {
        color: "white",
        fontSize: 18,
        fontWeight: "bold",
    },
    countdownContainer: {
        position: "absolute",
        top: "40%",
        left: "50%",
        transform: [{ translateX: -50 }, { translateY: -50 }],
    },
    countdownText: {
        fontSize: 120,
        fontWeight: "bold",
        color: "rgba(255, 255, 255, 0.8)",
        textAlign: "center",
    },
});
