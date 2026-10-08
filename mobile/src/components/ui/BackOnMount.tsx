/**
 * Leave the screen once it has rendered — for "this record no longer exists"
 * cases. Calling navigation.goBack() during render is a side effect in render:
 * React warns about it, and it can pop twice.
 */

import { useEffect } from 'react';

export function BackOnMount({ navigation }: { navigation: { goBack: () => void; canGoBack?: () => boolean } }) {
    useEffect(() => {
        if (!navigation.canGoBack || navigation.canGoBack()) navigation.goBack();
    }, [navigation]);
    return null;
}
