import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBoundaryFollowThroughStore } from './boundaryFollowThroughCore';
export const boundaryFollowThroughStore = createBoundaryFollowThroughStore(AsyncStorage);
