/**
 * Coverage and network reference data.
 *
 * Every country carries its real MCC and a plausible operator list with real
 * MNCs, so `GET /networks` returns data that looks like the live API.
 */

/** @typedef {{name: string, brandName: string, mnc: string, speed: string[]}} Operator */

const FIVE_G = ['3G', '4G', '5G'];
const FOUR_G = ['3G', '4G'];

/**
 * iso, name, region, mcc, operators
 * @type {{iso: string, name: string, region: string, mcc: string, operators: Operator[]}[]}
 */
export const COUNTRIES = [
  // ---------------------------------------------------------------- Europe
  { iso: 'GB', name: 'United Kingdom', region: 'Europe', mcc: '234', operators: [
    { name: 'EE', brandName: 'EE', mnc: '30', speed: FIVE_G },
    { name: 'O2', brandName: 'O2 - UK', mnc: '10', speed: FIVE_G },
    { name: 'Vodafone', brandName: 'Vodafone UK', mnc: '15', speed: FIVE_G },
    { name: 'Three', brandName: 'Three UK', mnc: '20', speed: FOUR_G },
  ] },
  { iso: 'IE', name: 'Ireland', region: 'Europe', mcc: '272', operators: [
    { name: 'Vodafone', brandName: 'Vodafone Ireland', mnc: '01', speed: FIVE_G },
    { name: 'Three', brandName: 'Three Ireland', mnc: '05', speed: FOUR_G },
    { name: 'Eir', brandName: 'eir', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'DE', name: 'Germany', region: 'Europe', mcc: '262', operators: [
    { name: 'Telekom', brandName: 'Telekom Deutschland', mnc: '01', speed: FIVE_G },
    { name: 'Vodafone', brandName: 'Vodafone Germany', mnc: '02', speed: FIVE_G },
    { name: 'O2', brandName: 'Telefonica O2 Germany', mnc: '03', speed: FIVE_G },
  ] },
  { iso: 'FR', name: 'France', region: 'Europe', mcc: '208', operators: [
    { name: 'Orange', brandName: 'Orange France', mnc: '01', speed: FIVE_G },
    { name: 'SFR', brandName: 'SFR', mnc: '10', speed: FIVE_G },
    { name: 'Bouygues', brandName: 'Bouygues Telecom', mnc: '20', speed: FOUR_G },
    { name: 'Free', brandName: 'Free Mobile', mnc: '15', speed: FOUR_G },
  ] },
  { iso: 'IT', name: 'Italy', region: 'Europe', mcc: '222', operators: [
    { name: 'TIM', brandName: 'TIM Italia', mnc: '01', speed: FIVE_G },
    { name: 'Vodafone', brandName: 'Vodafone Italia', mnc: '10', speed: FIVE_G },
    { name: 'WindTre', brandName: 'WindTre', mnc: '88', speed: FOUR_G },
  ] },
  { iso: 'ES', name: 'Spain', region: 'Europe', mcc: '214', operators: [
    { name: 'Movistar', brandName: 'Movistar', mnc: '07', speed: FIVE_G },
    { name: 'Vodafone', brandName: 'Vodafone Spain', mnc: '01', speed: FIVE_G },
    { name: 'Orange', brandName: 'Orange Spain', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'PT', name: 'Portugal', region: 'Europe', mcc: '268', operators: [
    { name: 'MEO', brandName: 'MEO', mnc: '06', speed: FIVE_G },
    { name: 'Vodafone', brandName: 'Vodafone Portugal', mnc: '01', speed: FIVE_G },
    { name: 'NOS', brandName: 'NOS', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'NL', name: 'Netherlands', region: 'Europe', mcc: '204', operators: [
    { name: 'KPN', brandName: 'KPN', mnc: '08', speed: FIVE_G },
    { name: 'Vodafone', brandName: 'VodafoneZiggo', mnc: '04', speed: FIVE_G },
    { name: 'T-Mobile', brandName: 'Odido', mnc: '16', speed: FOUR_G },
  ] },
  { iso: 'BE', name: 'Belgium', region: 'Europe', mcc: '206', operators: [
    { name: 'Proximus', brandName: 'Proximus', mnc: '01', speed: FIVE_G },
    { name: 'Orange', brandName: 'Orange Belgium', mnc: '10', speed: FOUR_G },
    { name: 'Base', brandName: 'BASE', mnc: '20', speed: FOUR_G },
  ] },
  { iso: 'LU', name: 'Luxembourg', region: 'Europe', mcc: '270', operators: [
    { name: 'POST', brandName: 'POST Luxembourg', mnc: '01', speed: FOUR_G },
    { name: 'Orange', brandName: 'Orange Luxembourg', mnc: '99', speed: FOUR_G },
    { name: 'Tango', brandName: 'Tango', mnc: '77', speed: FOUR_G },
  ] },
  { iso: 'AT', name: 'Austria', region: 'Europe', mcc: '232', operators: [
    { name: 'A1', brandName: 'A1 Telekom Austria', mnc: '01', speed: FIVE_G },
    { name: 'Magenta', brandName: 'Magenta Telekom', mnc: '03', speed: FIVE_G },
    { name: 'Drei', brandName: 'Drei Austria', mnc: '10', speed: FOUR_G },
  ] },
  { iso: 'CH', name: 'Switzerland', region: 'Europe', mcc: '228', operators: [
    { name: 'Swisscom', brandName: 'Swisscom', mnc: '01', speed: FIVE_G },
    { name: 'Sunrise', brandName: 'Sunrise', mnc: '02', speed: FIVE_G },
    { name: 'Salt', brandName: 'Salt Mobile', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'SE', name: 'Sweden', region: 'Europe', mcc: '240', operators: [
    { name: 'Telia', brandName: 'Telia Sverige', mnc: '01', speed: FIVE_G },
    { name: 'Tele2', brandName: 'Tele2 Sverige', mnc: '07', speed: FOUR_G },
    { name: 'Telenor', brandName: 'Telenor Sverige', mnc: '08', speed: FOUR_G },
  ] },
  { iso: 'NO', name: 'Norway', region: 'Europe', mcc: '242', operators: [
    { name: 'Telenor', brandName: 'Telenor Norge', mnc: '01', speed: FIVE_G },
    { name: 'Telia', brandName: 'Telia Norge', mnc: '02', speed: FIVE_G },
    { name: 'Ice', brandName: 'ice.net', mnc: '14', speed: FOUR_G },
  ] },
  { iso: 'DK', name: 'Denmark', region: 'Europe', mcc: '238', operators: [
    { name: 'TDC', brandName: 'Nuuday / TDC', mnc: '01', speed: FIVE_G },
    { name: 'Telenor', brandName: 'Telenor Denmark', mnc: '02', speed: FOUR_G },
    { name: 'Telia', brandName: 'Telia Denmark', mnc: '20', speed: FOUR_G },
  ] },
  { iso: 'FI', name: 'Finland', region: 'Europe', mcc: '244', operators: [
    { name: 'Elisa', brandName: 'Elisa', mnc: '05', speed: FIVE_G },
    { name: 'Telia', brandName: 'Telia Finland', mnc: '91', speed: FIVE_G },
    { name: 'DNA', brandName: 'DNA', mnc: '12', speed: FOUR_G },
  ] },
  { iso: 'IS', name: 'Iceland', region: 'Europe', mcc: '274', operators: [
    { name: 'Siminn', brandName: 'Siminn', mnc: '01', speed: FOUR_G },
    { name: 'Vodafone', brandName: 'Vodafone Iceland', mnc: '02', speed: FOUR_G },
    { name: 'Nova', brandName: 'Nova', mnc: '11', speed: FOUR_G },
  ] },
  { iso: 'PL', name: 'Poland', region: 'Europe', mcc: '260', operators: [
    { name: 'Plus', brandName: 'Plus', mnc: '01', speed: FIVE_G },
    { name: 'T-Mobile', brandName: 'T-Mobile Polska', mnc: '02', speed: FIVE_G },
    { name: 'Orange', brandName: 'Orange Polska', mnc: '03', speed: FOUR_G },
    { name: 'Play', brandName: 'Play', mnc: '06', speed: FOUR_G },
  ] },
  { iso: 'CZ', name: 'Czech Republic', region: 'Europe', mcc: '230', operators: [
    { name: 'T-Mobile', brandName: 'T-Mobile Czech', mnc: '01', speed: FIVE_G },
    { name: 'O2', brandName: 'O2 Czech Republic', mnc: '02', speed: FOUR_G },
    { name: 'Vodafone', brandName: 'Vodafone Czech', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'SK', name: 'Slovakia', region: 'Europe', mcc: '231', operators: [
    { name: 'Orange', brandName: 'Orange Slovensko', mnc: '01', speed: FOUR_G },
    { name: 'Telekom', brandName: 'Slovak Telekom', mnc: '02', speed: FOUR_G },
    { name: 'O2', brandName: 'O2 Slovakia', mnc: '06', speed: FOUR_G },
  ] },
  { iso: 'HU', name: 'Hungary', region: 'Europe', mcc: '216', operators: [
    { name: 'Telekom', brandName: 'Magyar Telekom', mnc: '30', speed: FIVE_G },
    { name: 'Yettel', brandName: 'Yettel Hungary', mnc: '01', speed: FOUR_G },
    { name: 'Vodafone', brandName: 'Vodafone Hungary', mnc: '70', speed: FOUR_G },
  ] },
  { iso: 'SI', name: 'Slovenia', region: 'Europe', mcc: '293', operators: [
    { name: 'Telekom Slovenije', brandName: 'Telekom Slovenije', mnc: '41', speed: FOUR_G },
    { name: 'A1', brandName: 'A1 Slovenija', mnc: '40', speed: FOUR_G },
    { name: 'Telemach', brandName: 'Telemach', mnc: '70', speed: FOUR_G },
  ] },
  { iso: 'HR', name: 'Croatia', region: 'Europe', mcc: '219', operators: [
    { name: 'Hrvatski Telekom', brandName: 'Hrvatski Telekom', mnc: '01', speed: FIVE_G },
    { name: 'A1', brandName: 'A1 Hrvatska', mnc: '10', speed: FOUR_G },
    { name: 'Telemach', brandName: 'Telemach Croatia', mnc: '02', speed: FOUR_G },
  ] },
  { iso: 'GR', name: 'Greece', region: 'Europe', mcc: '202', operators: [
    { name: 'Cosmote', brandName: 'COSMOTE', mnc: '01', speed: FIVE_G },
    { name: 'Vodafone', brandName: 'Vodafone Greece', mnc: '05', speed: FOUR_G },
    { name: 'Nova', brandName: 'Nova Greece', mnc: '10', speed: FOUR_G },
  ] },
  { iso: 'RO', name: 'Romania', region: 'Europe', mcc: '226', operators: [
    { name: 'Vodafone', brandName: 'Vodafone Romania', mnc: '01', speed: FIVE_G },
    { name: 'Orange', brandName: 'Orange Romania', mnc: '10', speed: FIVE_G },
    { name: 'Telekom', brandName: 'Telekom Romania', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'BG', name: 'Bulgaria', region: 'Europe', mcc: '284', operators: [
    { name: 'A1', brandName: 'A1 Bulgaria', mnc: '01', speed: FOUR_G },
    { name: 'Yettel', brandName: 'Yettel Bulgaria', mnc: '05', speed: FOUR_G },
    { name: 'Vivacom', brandName: 'Vivacom', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'EE', name: 'Estonia', region: 'Europe', mcc: '248', operators: [
    { name: 'Telia', brandName: 'Telia Eesti', mnc: '01', speed: FOUR_G },
    { name: 'Elisa', brandName: 'Elisa Eesti', mnc: '02', speed: FOUR_G },
    { name: 'Tele2', brandName: 'Tele2 Eesti', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'LV', name: 'Latvia', region: 'Europe', mcc: '247', operators: [
    { name: 'LMT', brandName: 'LMT', mnc: '01', speed: FOUR_G },
    { name: 'Tele2', brandName: 'Tele2 Latvia', mnc: '02', speed: FOUR_G },
    { name: 'Bite', brandName: 'Bite Latvija', mnc: '05', speed: FOUR_G },
  ] },
  { iso: 'LT', name: 'Lithuania', region: 'Europe', mcc: '246', operators: [
    { name: 'Telia', brandName: 'Telia Lietuva', mnc: '01', speed: FOUR_G },
    { name: 'Bite', brandName: 'Bite Lietuva', mnc: '02', speed: FOUR_G },
    { name: 'Tele2', brandName: 'Tele2 Lietuva', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'CY', name: 'Cyprus', region: 'Europe', mcc: '280', operators: [
    { name: 'Cyta', brandName: 'Cytamobile-Vodafone', mnc: '01', speed: FOUR_G },
    { name: 'Epic', brandName: 'Epic Cyprus', mnc: '10', speed: FOUR_G },
    { name: 'PrimeTel', brandName: 'PrimeTel', mnc: '20', speed: FOUR_G },
  ] },
  { iso: 'MT', name: 'Malta', region: 'Europe', mcc: '278', operators: [
    { name: 'Vodafone', brandName: 'Vodafone Malta', mnc: '01', speed: FOUR_G },
    { name: 'Epic', brandName: 'Epic Malta', mnc: '21', speed: FOUR_G },
    { name: 'GO', brandName: 'GO Mobile', mnc: '77', speed: FOUR_G },
  ] },
  { iso: 'TR', name: 'Turkey', region: 'Europe', mcc: '286', operators: [
    { name: 'Turkcell', brandName: 'Turkcell', mnc: '01', speed: FIVE_G },
    { name: 'Vodafone', brandName: 'Vodafone Turkiye', mnc: '02', speed: FOUR_G },
    { name: 'Turk Telekom', brandName: 'Turk Telekom', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'UA', name: 'Ukraine', region: 'Europe', mcc: '255', operators: [
    { name: 'Kyivstar', brandName: 'Kyivstar', mnc: '03', speed: FOUR_G },
    { name: 'Vodafone', brandName: 'Vodafone Ukraine', mnc: '01', speed: FOUR_G },
    { name: 'lifecell', brandName: 'lifecell', mnc: '06', speed: FOUR_G },
  ] },

  // -------------------------------------------------------- North America
  { iso: 'US', name: 'United States', region: 'North America', mcc: '310', operators: [
    { name: 'AT&T', brandName: 'AT&T Mobility', mnc: '410', speed: FIVE_G },
    { name: 'T-Mobile', brandName: 'T-Mobile USA', mnc: '260', speed: FIVE_G },
    { name: 'Verizon', brandName: 'Verizon Wireless', mnc: '480', speed: FIVE_G },
  ] },
  { iso: 'CA', name: 'Canada', region: 'North America', mcc: '302', operators: [
    { name: 'Rogers', brandName: 'Rogers Wireless', mnc: '720', speed: FIVE_G },
    { name: 'Bell', brandName: 'Bell Mobility', mnc: '610', speed: FIVE_G },
    { name: 'Telus', brandName: 'TELUS Mobility', mnc: '220', speed: FOUR_G },
  ] },
  { iso: 'MX', name: 'Mexico', region: 'North America', mcc: '334', operators: [
    { name: 'Telcel', brandName: 'Telcel', mnc: '020', speed: FIVE_G },
    { name: 'AT&T', brandName: 'AT&T Mexico', mnc: '050', speed: FOUR_G },
    { name: 'Movistar', brandName: 'Movistar Mexico', mnc: '030', speed: FOUR_G },
  ] },

  // -------------------------------------------------------- South America
  { iso: 'BR', name: 'Brazil', region: 'South America', mcc: '724', operators: [
    { name: 'Vivo', brandName: 'Vivo', mnc: '06', speed: FIVE_G },
    { name: 'Claro', brandName: 'Claro Brasil', mnc: '05', speed: FIVE_G },
    { name: 'TIM', brandName: 'TIM Brasil', mnc: '04', speed: FOUR_G },
  ] },
  { iso: 'AR', name: 'Argentina', region: 'South America', mcc: '722', operators: [
    { name: 'Personal', brandName: 'Personal', mnc: '034', speed: FOUR_G },
    { name: 'Claro', brandName: 'Claro Argentina', mnc: '310', speed: FOUR_G },
    { name: 'Movistar', brandName: 'Movistar Argentina', mnc: '070', speed: FOUR_G },
  ] },
  { iso: 'CL', name: 'Chile', region: 'South America', mcc: '730', operators: [
    { name: 'Entel', brandName: 'Entel Chile', mnc: '01', speed: FIVE_G },
    { name: 'Movistar', brandName: 'Movistar Chile', mnc: '02', speed: FOUR_G },
    { name: 'Claro', brandName: 'Claro Chile', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'CO', name: 'Colombia', region: 'South America', mcc: '732', operators: [
    { name: 'Claro', brandName: 'Claro Colombia', mnc: '101', speed: FOUR_G },
    { name: 'Movistar', brandName: 'Movistar Colombia', mnc: '123', speed: FOUR_G },
    { name: 'Tigo', brandName: 'Tigo Colombia', mnc: '103', speed: FOUR_G },
  ] },
  { iso: 'PE', name: 'Peru', region: 'South America', mcc: '716', operators: [
    { name: 'Claro', brandName: 'Claro Peru', mnc: '10', speed: FOUR_G },
    { name: 'Movistar', brandName: 'Movistar Peru', mnc: '06', speed: FOUR_G },
    { name: 'Entel', brandName: 'Entel Peru', mnc: '17', speed: FOUR_G },
  ] },

  // ------------------------------------------------------------------ Asia
  { iso: 'JP', name: 'Japan', region: 'Asia', mcc: '440', operators: [
    { name: 'NTT Docomo', brandName: 'NTT docomo', mnc: '10', speed: FIVE_G },
    { name: 'SoftBank', brandName: 'SoftBank', mnc: '20', speed: FIVE_G },
    { name: 'KDDI', brandName: 'au by KDDI', mnc: '50', speed: FIVE_G },
  ] },
  { iso: 'KR', name: 'South Korea', region: 'Asia', mcc: '450', operators: [
    { name: 'SK Telecom', brandName: 'SK Telecom', mnc: '05', speed: FIVE_G },
    { name: 'KT', brandName: 'KT Corporation', mnc: '08', speed: FIVE_G },
    { name: 'LG U+', brandName: 'LG Uplus', mnc: '06', speed: FIVE_G },
  ] },
  { iso: 'CN', name: 'China', region: 'Asia', mcc: '460', operators: [
    { name: 'China Mobile', brandName: 'China Mobile', mnc: '00', speed: FIVE_G },
    { name: 'China Unicom', brandName: 'China Unicom', mnc: '01', speed: FIVE_G },
    { name: 'China Telecom', brandName: 'China Telecom', mnc: '11', speed: FOUR_G },
  ] },
  { iso: 'HK', name: 'Hong Kong', region: 'Asia', mcc: '454', operators: [
    { name: 'CSL', brandName: 'csl.', mnc: '00', speed: FIVE_G },
    { name: 'SmarTone', brandName: 'SmarTone', mnc: '06', speed: FIVE_G },
    { name: '3HK', brandName: '3 Hong Kong', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'TW', name: 'Taiwan', region: 'Asia', mcc: '466', operators: [
    { name: 'Chunghwa', brandName: 'Chunghwa Telecom', mnc: '92', speed: FIVE_G },
    { name: 'Taiwan Mobile', brandName: 'Taiwan Mobile', mnc: '97', speed: FIVE_G },
    { name: 'FarEasTone', brandName: 'FarEasTone', mnc: '01', speed: FOUR_G },
  ] },
  { iso: 'SG', name: 'Singapore', region: 'Asia', mcc: '525', operators: [
    { name: 'Singtel', brandName: 'Singtel', mnc: '01', speed: FIVE_G },
    { name: 'StarHub', brandName: 'StarHub', mnc: '05', speed: FIVE_G },
    { name: 'M1', brandName: 'M1', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'MY', name: 'Malaysia', region: 'Asia', mcc: '502', operators: [
    { name: 'Maxis', brandName: 'Maxis', mnc: '12', speed: FIVE_G },
    { name: 'Celcom', brandName: 'CelcomDigi', mnc: '19', speed: FOUR_G },
    { name: 'Digi', brandName: 'Digi Telecommunications', mnc: '16', speed: FOUR_G },
  ] },
  { iso: 'TH', name: 'Thailand', region: 'Asia', mcc: '520', operators: [
    { name: 'AIS', brandName: 'AIS', mnc: '03', speed: FIVE_G },
    { name: 'dtac', brandName: 'dtac', mnc: '18', speed: FOUR_G },
    { name: 'TrueMove', brandName: 'TrueMove H', mnc: '00', speed: FIVE_G },
  ] },
  { iso: 'VN', name: 'Vietnam', region: 'Asia', mcc: '452', operators: [
    { name: 'Viettel', brandName: 'Viettel Mobile', mnc: '04', speed: FOUR_G },
    { name: 'Vinaphone', brandName: 'VinaPhone', mnc: '02', speed: FOUR_G },
    { name: 'Mobifone', brandName: 'MobiFone', mnc: '01', speed: FOUR_G },
  ] },
  { iso: 'ID', name: 'Indonesia', region: 'Asia', mcc: '510', operators: [
    { name: 'Telkomsel', brandName: 'Telkomsel', mnc: '10', speed: FIVE_G },
    { name: 'Indosat', brandName: 'Indosat Ooredoo Hutchison', mnc: '01', speed: FOUR_G },
    { name: 'XL', brandName: 'XL Axiata', mnc: '11', speed: FOUR_G },
  ] },
  { iso: 'PH', name: 'Philippines', region: 'Asia', mcc: '515', operators: [
    { name: 'Globe', brandName: 'Globe Telecom', mnc: '02', speed: FIVE_G },
    { name: 'Smart', brandName: 'Smart Communications', mnc: '03', speed: FIVE_G },
    { name: 'DITO', brandName: 'DITO Telecommunity', mnc: '66', speed: FOUR_G },
  ] },
  { iso: 'IN', name: 'India', region: 'Asia', mcc: '404', operators: [
    { name: 'Airtel', brandName: 'Bharti Airtel', mnc: '10', speed: FIVE_G },
    { name: 'Vi', brandName: 'Vodafone Idea', mnc: '11', speed: FOUR_G },
    { name: 'Jio', brandName: 'Reliance Jio', mnc: '857', speed: FIVE_G },
  ] },
  { iso: 'LK', name: 'Sri Lanka', region: 'Asia', mcc: '413', operators: [
    { name: 'Dialog', brandName: 'Dialog Axiata', mnc: '02', speed: FOUR_G },
    { name: 'Mobitel', brandName: 'Mobitel', mnc: '01', speed: FOUR_G },
    { name: 'Hutch', brandName: 'Hutch Sri Lanka', mnc: '08', speed: FOUR_G },
  ] },
  { iso: 'PK', name: 'Pakistan', region: 'Asia', mcc: '410', operators: [
    { name: 'Jazz', brandName: 'Jazz', mnc: '01', speed: FOUR_G },
    { name: 'Zong', brandName: 'Zong', mnc: '04', speed: FOUR_G },
    { name: 'Telenor', brandName: 'Telenor Pakistan', mnc: '06', speed: FOUR_G },
  ] },
  { iso: 'BD', name: 'Bangladesh', region: 'Asia', mcc: '470', operators: [
    { name: 'Grameenphone', brandName: 'Grameenphone', mnc: '01', speed: FOUR_G },
    { name: 'Robi', brandName: 'Robi Axiata', mnc: '02', speed: FOUR_G },
    { name: 'Banglalink', brandName: 'Banglalink', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'NP', name: 'Nepal', region: 'Asia', mcc: '429', operators: [
    { name: 'NTC', brandName: 'Nepal Telecom', mnc: '01', speed: FOUR_G },
    { name: 'Ncell', brandName: 'Ncell', mnc: '02', speed: FOUR_G },
  ] },
  { iso: 'KZ', name: 'Kazakhstan', region: 'Asia', mcc: '401', operators: [
    { name: 'Beeline', brandName: 'Beeline Kazakhstan', mnc: '01', speed: FOUR_G },
    { name: 'Kcell', brandName: 'Kcell', mnc: '02', speed: FOUR_G },
    { name: 'Tele2', brandName: 'Tele2 Kazakhstan', mnc: '77', speed: FOUR_G },
  ] },
  { iso: 'GE', name: 'Georgia', region: 'Asia', mcc: '282', operators: [
    { name: 'Magti', brandName: 'Magticom', mnc: '02', speed: FOUR_G },
    { name: 'Silknet', brandName: 'Silknet', mnc: '04', speed: FOUR_G },
    { name: 'Beeline', brandName: 'Beeline Georgia', mnc: '01', speed: FOUR_G },
  ] },
  { iso: 'AM', name: 'Armenia', region: 'Asia', mcc: '283', operators: [
    { name: 'Beeline', brandName: 'Beeline Armenia', mnc: '04', speed: FOUR_G },
    { name: 'Ucom', brandName: 'Ucom', mnc: '10', speed: FOUR_G },
    { name: 'VivaCell', brandName: 'Viva-MTS', mnc: '05', speed: FOUR_G },
  ] },
  { iso: 'AZ', name: 'Azerbaijan', region: 'Asia', mcc: '400', operators: [
    { name: 'Azercell', brandName: 'Azercell', mnc: '01', speed: FOUR_G },
    { name: 'Bakcell', brandName: 'Bakcell', mnc: '02', speed: FOUR_G },
    { name: 'Nar', brandName: 'Nar Mobile', mnc: '04', speed: FOUR_G },
  ] },

  // ---------------------------------------------------------- Middle East
  { iso: 'AE', name: 'United Arab Emirates', region: 'Middle East', mcc: '424', operators: [
    { name: 'Etisalat', brandName: 'e& UAE', mnc: '02', speed: FIVE_G },
    { name: 'du', brandName: 'du', mnc: '03', speed: FIVE_G },
  ] },
  { iso: 'SA', name: 'Saudi Arabia', region: 'Middle East', mcc: '420', operators: [
    { name: 'STC', brandName: 'stc', mnc: '01', speed: FIVE_G },
    { name: 'Mobily', brandName: 'Mobily', mnc: '03', speed: FIVE_G },
    { name: 'Zain', brandName: 'Zain KSA', mnc: '04', speed: FOUR_G },
  ] },
  { iso: 'QA', name: 'Qatar', region: 'Middle East', mcc: '427', operators: [
    { name: 'Ooredoo', brandName: 'Ooredoo Qatar', mnc: '01', speed: FIVE_G },
    { name: 'Vodafone', brandName: 'Vodafone Qatar', mnc: '02', speed: FIVE_G },
  ] },
  { iso: 'KW', name: 'Kuwait', region: 'Middle East', mcc: '419', operators: [
    { name: 'Zain', brandName: 'Zain Kuwait', mnc: '02', speed: FIVE_G },
    { name: 'Ooredoo', brandName: 'Ooredoo Kuwait', mnc: '03', speed: FOUR_G },
    { name: 'STC', brandName: 'stc Kuwait', mnc: '04', speed: FOUR_G },
  ] },
  { iso: 'BH', name: 'Bahrain', region: 'Middle East', mcc: '426', operators: [
    { name: 'Batelco', brandName: 'Batelco', mnc: '01', speed: FIVE_G },
    { name: 'STC', brandName: 'stc Bahrain', mnc: '02', speed: FOUR_G },
    { name: 'Zain', brandName: 'Zain Bahrain', mnc: '04', speed: FOUR_G },
  ] },
  { iso: 'OM', name: 'Oman', region: 'Middle East', mcc: '422', operators: [
    { name: 'Omantel', brandName: 'Omantel', mnc: '02', speed: FOUR_G },
    { name: 'Ooredoo', brandName: 'Ooredoo Oman', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'IL', name: 'Israel', region: 'Middle East', mcc: '425', operators: [
    { name: 'Partner', brandName: 'Partner Communications', mnc: '01', speed: FIVE_G },
    { name: 'Cellcom', brandName: 'Cellcom Israel', mnc: '02', speed: FOUR_G },
    { name: 'Pelephone', brandName: 'Pelephone', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'JO', name: 'Jordan', region: 'Middle East', mcc: '416', operators: [
    { name: 'Zain', brandName: 'Zain Jordan', mnc: '01', speed: FOUR_G },
    { name: 'Orange', brandName: 'Orange Jordan', mnc: '77', speed: FOUR_G },
    { name: 'Umniah', brandName: 'Umniah', mnc: '03', speed: FOUR_G },
  ] },

  // ---------------------------------------------------------------- Africa
  { iso: 'ZA', name: 'South Africa', region: 'Africa', mcc: '655', operators: [
    { name: 'Vodacom', brandName: 'Vodacom', mnc: '01', speed: FIVE_G },
    { name: 'MTN', brandName: 'MTN South Africa', mnc: '10', speed: FIVE_G },
    { name: 'Cell C', brandName: 'Cell C', mnc: '07', speed: FOUR_G },
  ] },
  { iso: 'EG', name: 'Egypt', region: 'Africa', mcc: '602', operators: [
    { name: 'Orange', brandName: 'Orange Egypt', mnc: '01', speed: FOUR_G },
    { name: 'Vodafone', brandName: 'Vodafone Egypt', mnc: '02', speed: FOUR_G },
    { name: 'Etisalat', brandName: 'e& Egypt', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'MA', name: 'Morocco', region: 'Africa', mcc: '604', operators: [
    { name: 'IAM', brandName: 'Maroc Telecom', mnc: '01', speed: FOUR_G },
    { name: 'Orange', brandName: 'Orange Maroc', mnc: '00', speed: FOUR_G },
    { name: 'Inwi', brandName: 'inwi', mnc: '02', speed: FOUR_G },
  ] },
  { iso: 'TN', name: 'Tunisia', region: 'Africa', mcc: '605', operators: [
    { name: 'Orange', brandName: 'Orange Tunisie', mnc: '01', speed: FOUR_G },
    { name: 'Tunisie Telecom', brandName: 'Tunisie Telecom', mnc: '02', speed: FOUR_G },
    { name: 'Ooredoo', brandName: 'Ooredoo Tunisie', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'KE', name: 'Kenya', region: 'Africa', mcc: '639', operators: [
    { name: 'Safaricom', brandName: 'Safaricom', mnc: '02', speed: FIVE_G },
    { name: 'Airtel', brandName: 'Airtel Kenya', mnc: '03', speed: FOUR_G },
    { name: 'Telkom', brandName: 'Telkom Kenya', mnc: '07', speed: FOUR_G },
  ] },
  { iso: 'NG', name: 'Nigeria', region: 'Africa', mcc: '621', operators: [
    { name: 'MTN', brandName: 'MTN Nigeria', mnc: '30', speed: FIVE_G },
    { name: 'Airtel', brandName: 'Airtel Nigeria', mnc: '20', speed: FOUR_G },
    { name: 'Glo', brandName: 'Globacom', mnc: '50', speed: FOUR_G },
  ] },
  { iso: 'GH', name: 'Ghana', region: 'Africa', mcc: '620', operators: [
    { name: 'MTN', brandName: 'MTN Ghana', mnc: '01', speed: FOUR_G },
    { name: 'Vodafone', brandName: 'Telecel Ghana', mnc: '02', speed: FOUR_G },
    { name: 'AirtelTigo', brandName: 'AT Ghana', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'TZ', name: 'Tanzania', region: 'Africa', mcc: '640', operators: [
    { name: 'Vodacom', brandName: 'Vodacom Tanzania', mnc: '04', speed: FOUR_G },
    { name: 'Airtel', brandName: 'Airtel Tanzania', mnc: '02', speed: FOUR_G },
    { name: 'Tigo', brandName: 'Yas Tanzania', mnc: '03', speed: FOUR_G },
  ] },

  // --------------------------------------------------------------- Oceania
  { iso: 'AU', name: 'Australia', region: 'Oceania', mcc: '505', operators: [
    { name: 'Telstra', brandName: 'Telstra', mnc: '01', speed: FIVE_G },
    { name: 'Optus', brandName: 'Optus', mnc: '02', speed: FIVE_G },
    { name: 'Vodafone', brandName: 'Vodafone Australia', mnc: '03', speed: FOUR_G },
  ] },
  { iso: 'NZ', name: 'New Zealand', region: 'Oceania', mcc: '530', operators: [
    { name: 'Spark', brandName: 'Spark NZ', mnc: '05', speed: FIVE_G },
    { name: 'One NZ', brandName: 'One New Zealand', mnc: '01', speed: FIVE_G },
    { name: '2degrees', brandName: '2degrees', mnc: '24', speed: FOUR_G },
  ] },
  { iso: 'FJ', name: 'Fiji', region: 'Oceania', mcc: '542', operators: [
    { name: 'Vodafone', brandName: 'Vodafone Fiji', mnc: '01', speed: FOUR_G },
    { name: 'Digicel', brandName: 'Digicel Fiji', mnc: '02', speed: FOUR_G },
  ] },
];

export const COUNTRY_BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c]));
export const COUNTRY_BY_NAME = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c]));

/**
 * Reduce a country record to the `{name, region, iso}` triple the catalogue
 * endpoints return.
 *
 * @param {{name: string, region: string, iso: string}} c
 * @returns {{name: string, region: string, iso: string}}
 */
export const asCoverage = (c) => ({ name: c.name, region: c.region, iso: c.iso });

export const REGIONS = [...new Set(COUNTRIES.map((c) => c.region))];

/** Region code used in generated bundle names, e.g. esim_5GB_30D_EU_V2. */
export const REGION_CODES = {
  Europe: 'EU',
  'North America': 'NA',
  'South America': 'SA',
  Asia: 'AS',
  'Middle East': 'ME',
  Africa: 'AF',
  Oceania: 'OC',
};

/**
 * Every country in a region.
 *
 * @param {string} region Region name, e.g. `Europe`.
 * @returns {object[]} Country reference records.
 */
export const countriesInRegion = (region) => COUNTRIES.filter((c) => c.region === region);
