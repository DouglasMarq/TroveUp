import {Composition} from 'remotion';
import {Promo} from './Promo';

export const Root: React.FC = () => {
  return (
    <Composition
      id="TroveUpPromo"
      component={Promo}
      durationInFrames={300}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
