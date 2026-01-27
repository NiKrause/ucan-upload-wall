import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface QRCodeGeneratorProps {
  value: string;
  size?: number;
}

export const QRCodeGenerator: React.FC<QRCodeGeneratorProps> = ({ value, size = 256 }) => {
  return (
    <div className="p-4 bg-white rounded-lg shadow-md inline-block">
      <QRCodeSVG value={value} size={size} level="M" />
    </div>
  );
};
