import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { Circle, Line, G } from 'react-native-svg';

interface RestartTimerProps {
  onComplete?: () => void;
  initialSeconds?: number;
}

export const RestartTimer = ({ onComplete, initialSeconds = 5 }: RestartTimerProps) => {
  const animationValue = useRef(new Animated.Value(0)).current;
  const timeLeftRef = useRef(initialSeconds);
  const [timeLeft, setTimeLeft] = React.useState(initialSeconds);
  const [clockHandAngle, setClockHandAngle] = React.useState(0);

  useEffect(() => {
    // Start the countdown animation
    Animated.timing(animationValue, {
      toValue: 1,
      duration: initialSeconds * 1000,
      useNativeDriver: true,
      easing: Easing.linear,
    }).start();

    // Update the countdown text and clock hand angle
    const interval = setInterval(() => {
      timeLeftRef.current -= 1;
      setTimeLeft(timeLeftRef.current);
      
      // Update clock hand angle (moves 72 degrees per second for 5 seconds = 360 degrees)
      setClockHandAngle(prev => prev + 72);
      
      if (timeLeftRef.current <= 0) {
        clearInterval(interval);
        onComplete?.();
      }
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const rotateData = animationValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const scaleValue = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Pulse animation on each second
    Animated.sequence([
      Animated.timing(scaleValue, {
        toValue: 1.2,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(scaleValue, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [timeLeft]);

  // Calculate clock hand position
  const handX = 50 + 30 * Math.sin(clockHandAngle * (Math.PI / 180));
  const handY = 50 - 30 * Math.cos(clockHandAngle * (Math.PI / 180));

  return (
    <View style={styles.container}>
      <View style={styles.circleContainer}>
        <Animated.View
          style={[
            styles.progressCircle,
            {
              transform: [
                { rotate: rotateData },
                { scale: scaleValue }
              ],
            },
          ]}
        />
        <Animated.Text
          style={[
            styles.timerText,
            {
              transform: [{ scale: scaleValue }],
            },
          ]}
        >
          {timeLeft}
        </Animated.Text>
      </View>

      {/* Clock Animation */}
      <View style={styles.clockContainer}>
        <Svg height="80" width="80" viewBox="0 0 100 100">
          {/* Clock face */}
          <Circle cx="50" cy="50" r="45" stroke="#ff69b4" strokeWidth="3" fill="rgba(0,0,0,0.3)" />
          
          {/* Hour marks */}
          {[...Array(12)].map((_, i) => {
            const angle = (i * 30) * (Math.PI / 180);
            const x1 = 50 + 38 * Math.sin(angle);
            const y1 = 50 - 38 * Math.cos(angle);
            const x2 = 50 + 45 * Math.sin(angle);
            const y2 = 50 - 45 * Math.cos(angle);
            return (
              <Line 
                key={i} 
                x1={x1} 
                y1={y1} 
                x2={x2} 
                y2={y2} 
                stroke="#ff69b4" 
                strokeWidth="2" 
              />
            );
          })}
          
          {/* Clock hand (simple line that updates on each tick) */}
          <Line 
            x1="50" 
            y1="50" 
            x2={handX}
            y2={handY}
            stroke="#ffffff" 
            strokeWidth="3" 
            strokeLinecap="round" 
          />
          <Circle cx="50" cy="50" r="5" fill="#ffffff" />
        </Svg>
      </View>
      
      <Text style={styles.restartText}>Game Restarting...</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleContainer: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  clockContainer: {
    marginBottom: 15,
  },
  progressCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 8,
    borderColor: '#ff69b4',
    position: 'absolute',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
    shadowColor: '#ff1493',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
  },
  timerText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#ffffff',
    textShadowColor: '#ff69b4',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  restartText: {
    marginTop: 10,
    fontSize: 22,
    color: '#ffffff',
    fontWeight: '600',
    textShadowColor: '#ff69b4',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 5,
  },
}); 