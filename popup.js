document.addEventListener('DOMContentLoaded', function() {
    // Get tabId from URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const tabId = parseInt(urlParams.get('tabId'));

    // Use chrome.tabs.get to get the tab information with the specific tabId
    chrome.tabs.get(tabId, function(currentTab) {
        var actionButton = document.getElementById('actionButton');
        var downloadCsvButton = document.getElementById('downloadCsvButton');
        var resultsTable = document.getElementById('resultsTable');
        var filenameInput = document.getElementById('filenameInput');

        if (currentTab && currentTab.url.includes("://www.google.com/maps/search")) {
            document.getElementById('message').textContent = "Let's scrape Google Maps!";
            actionButton.disabled = false;
            actionButton.classList.add('enabled');
        } else {
            var messageElement = document.getElementById('message');
            messageElement.innerHTML = '';
            var linkElement = document.createElement('a');
            linkElement.href = 'https://www.google.com/maps/search/';
            linkElement.textContent = "Go to Google Maps Search.";
            linkElement.target = '_blank'; 
            messageElement.appendChild(linkElement);

            actionButton.style.display = 'none'; 
            downloadCsvButton.style.display = 'none';
            filenameInput.style.display = 'none'; 
        }

        actionButton.addEventListener('click', function() {
            actionButton.disabled = true; // Disable button during scrape
            actionButton.textContent = "Scraping...";
            resultsTable.innerHTML = ''; // Clear previous results

            chrome.scripting.executeScript({
                target: {tabId: currentTab.id},
                function: scrollAndScrapeRepeatedly // Execute the new main scraping function
            }, function(injectionResults) {
                // Re-enable button and reset text
                actionButton.disabled = false;
                actionButton.textContent = "Scrape Again";

                if (chrome.runtime.lastError) {
                    console.error("Script injection failed: " + chrome.runtime.lastError.message);
                    document.getElementById('message').textContent = "Error during scraping. Check console.";
                    return;
                }
                
                const allScrapedData = injectionResults[0].result;
                if (!allScrapedData || allScrapedData.length === 0) {
                    document.getElementById('message').textContent = "No data scraped. Try a different search or scroll manually first.";
                    return;
                }

                // Define and add headers to the table
                const headers = ['Title', 'Phone', 'Industry', 'City/Country', 'Website', 'Google Maps Link'];
                const headerRow = document.createElement('tr');
                headers.forEach(headerText => {
                    const header = document.createElement('th');
                    header.textContent = headerText;
                    headerRow.appendChild(header);
                });
                resultsTable.appendChild(headerRow);

                // Add new results to the table
                allScrapedData.forEach(function(item) {
                    var row = document.createElement('tr');
                    ['title', 'phone', 'industry', 'cityCountry', 'companyUrl', 'href'].forEach(function(key) {
                        var cell = document.createElement('td');
                        var cellValue = item[key] || '';
                        // Remove "+" prefix if it exists
                        if (cellValue.startsWith('+')) {
                            cellValue = cellValue.substring('');
                        }
                        cell.textContent = cellValue; 
                        row.appendChild(cell);
                    });
                    resultsTable.appendChild(row);
                });

                if (allScrapedData.length > 0) {
                    downloadCsvButton.disabled = false;
                    document.getElementById('message').textContent = `Scraped ${allScrapedData.length} items.`;
                } else {
                     document.getElementById('message').textContent = "No items found or page structure changed.";
                }
            });
        });

        downloadCsvButton.addEventListener('click', function() {
            var csv = tableToCsv(resultsTable); 
            var filename = filenameInput.value.trim();
            if (!filename) {
                filename = 'google-maps-data.csv'; 
            } else {
                filename = filename.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.csv';
            }
            downloadCsv(csv, filename); 
        });

    });
});

// This function will be injected into the target page
async function scrollAndScrapeRepeatedly() {
    const MAX_SCROLLS = 10; // Max number of scroll attempts
    const SCROLL_DELAY = 2000; // ms to wait after a scroll for content to load
    const NO_NEW_CONTENT_LIMIT = 2; // Stop after this many scrolls with no new unique items
    const MAX_ITEMS_LIMIT = 100; // Maximum number of items to scrape (limit pool)

    let allItems = [];
    let noNewContentCount = 0;
    let scrollAttempts = 0;
    let scrapedItemIdentifiers = new Set(); // To track unique items

    // Function to extract website URL by clicking on place and reading side panel
    async function extractWebsiteFromPlace(container) {
        try {
            // Find the clickable link for this place
            const placeLink = container.querySelector('a.hfpxzc');
            if (!placeLink) return '';

            // Click on the place to load its details
            placeLink.click();
            
            // Wait for the details panel to load
            await wait(3000); // Increased wait time for better loading
            
            // Look for the website element in the side panel
            // The website link appears with class CsEnBe and aria-label containing "Website:"
            const websiteElement = document.querySelector('a.CsEnBe[aria-label*="Website:"]');
            
            if (websiteElement && websiteElement.href) {
                // Make sure it's not a Google link or other irrelevant domains
                const url = websiteElement.href;
                if (!url.includes('google.com') && 
                    !url.includes('facebook.com') && 
                    !url.includes('instagram.com') && 
                    !url.includes('twitter.com') && 
                    !url.includes('linkedin.com') && 
                    !url.includes('youtube.com') && 
                    !url.includes('maps.google') && 
                    url.startsWith('http')) {
                    
                    // Additional check: make sure the aria-label specifically mentions "Website"
                    const ariaLabel = websiteElement.getAttribute('aria-label') || '';
                    if (ariaLabel.toLowerCase().includes('website')) {
                        return url;
                    }
                }
            }
            
            // More specific alternative selector - only look for elements specifically marked as website
            const websiteLinks = Array.from(document.querySelectorAll('a[aria-label*="Website"]'));
            for (let link of websiteLinks) {
                const url = link.href;
                if (url && 
                    !url.includes('google.com') && 
                    !url.includes('facebook.com') && 
                    !url.includes('instagram.com') && 
                    !url.includes('twitter.com') && 
                    !url.includes('linkedin.com') && 
                    !url.includes('youtube.com') && 
                    !url.includes('maps.google') && 
                    url.startsWith('http')) {
                    return url;
                }
            }
            
            return '';
        } catch (error) {
            console.log('Error extracting website:', error);
            return '';
        }
    }

    // Helper function to extract data from the current view (previously scrapeData)
    function extractDataFromPage() {
        // Target the specific Google Maps search results structure
        var searchResults = Array.from(document.querySelectorAll('div[jsaction*="mouseover:pane.wfvdle"]'));
        
        return searchResults.map(container => {
            if (!container) return null;

            // Extract the main link to get the Google Maps URL
            var mainLink = container.querySelector('a.hfpxzc');
            if (!mainLink || !mainLink.href.includes('google.com/maps/place')) return null;

            var titleText = '';
            var phone = '';
            var industry = '';
            var cityCountry = '';

            // Extract title from the headline
            var titleElement = container.querySelector('.qBF1Pd.fontHeadlineSmall');
            if (titleElement) {
                titleText = titleElement.textContent.trim();
            }

            // Extract phone number from the specific phone span
            var phoneElement = container.querySelector('span.UsdlK');
            if (phoneElement) {
                phone = phoneElement.textContent.trim();
            }

            // Extract industry and city/country from the structured information    
            var infoElements = container.querySelectorAll('.W4Efsd .W4Efsd span');
            var infoTexts = Array.from(infoElements).map(el => el.textContent.trim()).filter(text => text && text !== '·');
            
            // First non-empty text is usually the industry
            if (infoTexts.length > 0) {
                industry = infoTexts[0];
            }

            // Look for city/country in the info texts (usually contains city or country info)
            for (let i = 1; i < infoTexts.length; i++) {
                var text = infoTexts[i];
                // Skip if it looks like hours, phone, or service info
                if (text.match(/closed|open|am|pm|delivery|in-store|pickup/i)) continue;
                if (text === phone) continue;
                
                // Look for location information - prioritize city/country over detailed addresses
                // Skip detailed street addresses and focus on broader location info
                if (text.match(/street|st\s|road|rd\s|avenue|ave\s|building|floor|ground|shop|unit|plot|showroom|suite|apt|apartment/i)) continue;
                
                // Look for text that seems like a city or broader location (not a detailed address)
                // Generally, city/country info is shorter and doesn't contain numbers or detailed address components
                if (text.length > 3 && text.length < 50 && !text.match(/^\d+/) && !text.match(/floor|level|unit|shop/i)) {
                    // If it contains common location separators or seems like a place name
                    if (text.match(/,|\s-\s/) || text.match(/^[A-Z][a-z]+(\s[A-Z][a-z]*)*$/)) {
                        cityCountry = text;
                        break;
                    }
                }
            }
            
            // Fallback: try to extract location from the URL or page context
            if (!cityCountry) {
                // Try to get location from the current page URL or search context
                var currentUrl = window.location.href;
                var urlLocationMatch = currentUrl.match(/maps\/search\/[^\/]*\+in\+([^\/&?]+)/i);
                if (urlLocationMatch) {
                    cityCountry = decodeURIComponent(urlLocationMatch[1]).replace(/\+/g, ' ');
                } else {
                    // Try to find any location-like text in the container
                    var allText = container.textContent || '';
                    var lines = allText.split(/[\n\r]+/).map(line => line.trim()).filter(line => line.length > 0);
                    
                    // Look for a line that might contain city/country info
                    for (let line of lines) {
                        // Skip lines with detailed address components
                        if (line.match(/street|st\s|road|rd\s|building|floor|shop|unit|suite|apt/i)) continue;
                        if (line.match(/^\d+/) || line.match(/phone|call|delivery|pickup/i)) continue;
                        
                        // Look for lines that seem like location names (contain letters, possibly commas)
                        if (line.length > 3 && line.length < 100 && line.match(/[a-zA-Z]/) && line.match(/^[^0-9]*$/)) {
                            cityCountry = line;
                            break;
                        }
                    }
                }
            }
            
            // Clean up the city/country text
            if (cityCountry) {
                // Remove common prefixes and clean up
                cityCountry = cityCountry.replace(/^(in\s+|near\s+|at\s+)/i, '').trim();
                // Limit length to avoid getting full addresses
                if (cityCountry.length > 80) {
                    cityCountry = cityCountry.substring(0, 80) + '...';
                }
            }

            // Use the main Google Maps link href as unique identifier
            const itemIdentifier = mainLink.href;

            return {
                identifier: itemIdentifier,
                title: titleText,
                phone: phone,
                industry: industry,
                cityCountry: cityCountry,
                companyUrl: '', // Will be filled later by visiting individual pages
                href: itemIdentifier,
            };
        }).filter(item => item !== null);
    }

    // Function to scroll the results panel
    function scrollPanel(panel) {
        if (panel) {
            const currentScrollTop = panel.scrollTop;
            panel.scrollTop = panel.scrollHeight;
            // Return true if we actually scrolled
            return panel.scrollTop > currentScrollTop;
        }
        return false;
    }

    // Promise wrapper for setTimeout
    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Attempt to find the scrollable element - updated for the new structure
    let scrollableElement = document.querySelector('div[role="feed"]');
    
    // If role="feed" is not found, try alternative selectors
    if (!scrollableElement) {
        // Look for the main results container
        scrollableElement = document.querySelector('.m6QErb.DxyBCb.kA9KIf.dS8AEf.XiKgde.ecceSd[role="feed"]');
    }
    
    if (!scrollableElement) {
        // Fallback: find any scrollable div that contains search results
        const containers = Array.from(document.querySelectorAll('div'));
        scrollableElement = containers.find(div => {
            return div.scrollHeight > div.clientHeight && 
                   div.querySelector('div[jsaction*="mouseover:pane.wfvdle"]') &&
                   getComputedStyle(div).overflowY !== 'visible';
        });
    }

    if (!scrollableElement) {
        console.warn("Scrollable element not found. Scraping only visible items.");
        // If no scrollable element, just scrape what's visible and return
        const initialItems = extractDataFromPage();
        initialItems.forEach(item => {
            if (item.identifier && !scrapedItemIdentifiers.has(item.identifier) && allItems.length < MAX_ITEMS_LIMIT) {
                allItems.push(item);
                scrapedItemIdentifiers.add(item.identifier);
            }
        });
        console.log(`Scraped ${allItems.length} items (no scrolling, limit: ${MAX_ITEMS_LIMIT})`);
        return allItems;
    }
    
    console.log("Found scrollable element:", scrollableElement);
    
    // Main scrolling and scraping loop with improved logic
    let consecutiveNoNewItems = 0;
    const MAX_CONSECUTIVE_NO_NEW_ITEMS = 3;
    
    while (scrollAttempts < MAX_SCROLLS && consecutiveNoNewItems < MAX_CONSECUTIVE_NO_NEW_ITEMS && allItems.length < MAX_ITEMS_LIMIT) {
        const previousItemCount = scrapedItemIdentifiers.size;
        const currentItemsOnPage = extractDataFromPage();

        // Add new unique items (but respect the limit)
        let newItemsFound = 0;
        currentItemsOnPage.forEach(item => {
            if (item.identifier && !scrapedItemIdentifiers.has(item.identifier) && allItems.length < MAX_ITEMS_LIMIT) {
                allItems.push(item);
                scrapedItemIdentifiers.add(item.identifier);
                newItemsFound++;
            }
        });

        console.log(`Scroll ${scrollAttempts + 1}: Found ${newItemsFound} new items. Total unique items: ${scrapedItemIdentifiers.size}/${MAX_ITEMS_LIMIT}`);

        // Check if we've reached the limit
        if (allItems.length >= MAX_ITEMS_LIMIT) {
            console.log(`Reached maximum limit of ${MAX_ITEMS_LIMIT} items.`);
            break;
        }

        if (newItemsFound > 0) {
            consecutiveNoNewItems = 0;
        } else {
            consecutiveNoNewItems++;
        }

        // Try to scroll
        const didScroll = scrollPanel(scrollableElement);
        scrollAttempts++;
        
        if (!didScroll) {
            console.log("Could not scroll further, likely reached the end.");
            break;
        }
        
        await wait(SCROLL_DELAY);

        // Additional check: if we haven't found new items in several attempts, try a longer wait
        if (consecutiveNoNewItems >= 2) {
            console.log("No new items found recently, waiting longer for content to load...");
            await wait(SCROLL_DELAY * 2);
        }
    }
    
    console.log(`Scrolling finished. Total scrolls: ${scrollAttempts}, Total unique items: ${allItems.length}/${MAX_ITEMS_LIMIT}`);
    
    // Now extract website URLs by visiting individual pages
    console.log('Starting website extraction...');
    const itemsWithWebsites = [];
    
    for (let i = 0; i < allItems.length; i++) {
        console.log(`Extracting website for ${i + 1}/${allItems.length}: ${allItems[i].title}`);
        
        // Find the original container for this item by searching for its title
        const searchResults = Array.from(document.querySelectorAll('div[jsaction*="mouseover:pane.wfvdle"]'));
        const container = searchResults.find(container => {
            const titleElement = container.querySelector('.qBF1Pd.fontHeadlineSmall');
            return titleElement && titleElement.textContent.trim() === allItems[i].title;
        });
        
        if (container) {
            const websiteUrl = await extractWebsiteFromPlace(container);
            if (websiteUrl) {
                allItems[i].companyUrl = websiteUrl;
                itemsWithWebsites.push(allItems[i]);
                console.log(`Found website for ${allItems[i].title}: ${websiteUrl}`);
            } else {
                console.log(`Skipping ${allItems[i].title} - no website found`);
            }
        } else {
            console.log(`Skipping ${allItems[i].title} - container not found`);
        }
        
        // Add a small delay between requests to be respectful
        await wait(1000);
    }
    
    console.log(`Website extraction completed. ${itemsWithWebsites.length} items with websites out of ${allItems.length} total items`);
    return itemsWithWebsites;
}

// Convert the table to a CSV string
function tableToCsv(table) {
    var csv = [];
    var rows = table.querySelectorAll('tr');
    
    for (var i = 0; i < rows.length; i++) {
        var row = [], cols = rows[i].querySelectorAll('td, th');
        
        for (var j = 0; j < cols.length; j++) {
            // Ensure double quotes within the cell text are escaped by doubling them
            let cellText = cols[j].innerText.replace(/"/g, '""');
            row.push('"' + cellText + '"');
        }
        csv.push(row.join(','));
    }
    return csv.join('\n');
}

// Download the CSV file
function downloadCsv(csv, filename) {
    var csvFile;
    var downloadLink;

    csvFile = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    downloadLink = document.createElement('a');
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink); // Clean up the link
}