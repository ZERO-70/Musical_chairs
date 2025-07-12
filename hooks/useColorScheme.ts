import { useColorScheme as _useColorScheme, ColorSchemeName } from 'react-native';

export const useColorScheme = (): ColorSchemeName => {
  return _useColorScheme();
};
