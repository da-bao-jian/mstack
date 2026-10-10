import qr from "qrcode-terminal";

export function pairingQr(uri: string): string {
	let output = "";
	qr.generate(uri, { small: true }, (result) => {
		output = result;
	});
	return output;
}
